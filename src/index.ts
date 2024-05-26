import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createReadStream, createWriteStream } from "fs";
import { deleteMessage, getQueueLength, sqsRun } from "./sqs";
import { isGPUAvailable } from "./checkGPU";

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
});

async function main() {
  let queueLength = await getQueueLength();
  while (queueLength !== null && queueLength > 0) {
    console.log(`Queue length: ${queueLength}. Starting transcoding...`);
    await transcodeVideo();
    queueLength = await getQueueLength();
  }
  console.log("No messages in the queue");
}

const transcodeVideo = async () => {
  try {
    const message_info = await sqsRun();
    console.log("Bucket info from main:", message_info);

    if (!message_info) {
      console.log("No valid message received, skipping processing.");
      return;
    }

    const sourceBucket = message_info.bucket;
    const sourceKey = message_info.key;
    const destKey = path.basename(sourceKey, path.extname(sourceKey));
    const bucketName = "stremify-vod-prod";

    console.table({
      sourceBucket,
      sourceKey,
      destKey,
      bucketName,
    });

    const tempDir = path.join(__dirname, "temp");
    const tempTranscodedDir = path.join(tempDir, "transcoded");

    console.table({
      temp_dir: tempDir,
      temp_transcode_dir: tempTranscodedDir,
    });

    const videoResolutions = [
      {
        name: "360p",
        width: 640,
        height: 360,
        bitrate: "800k",
        path: `${destKey}/360p/360p.m3u8`,
      },
      {
        name: "480p",
        width: 854,
        height: 480,
        bitrate: "1500k",
        path: `${destKey}/480p/480p.m3u8`,
      },
      {
        name: "720p",
        width: 1280,
        height: 720,
        bitrate: "3000k",
        path: `${destKey}/720p/720p.m3u8`,
      },
    ];

    const transcodeVideo = async (
      sourceBucket: string,
      sourceKey: string,
      destKey: string
    ) => {
      const st = new Date().getTime();

      try {
        const getObjectParams = {
          Bucket: sourceBucket,
          Key: sourceKey,
        };

        const getObjectCommand = new GetObjectCommand(getObjectParams);
        const { Body } = await s3Client.send(getObjectCommand);
        if (!Body) {
          throw new Error("No body received from S3");
        }

        const bodyData = await Body.transformToByteArray();

        await fs.promises.mkdir(tempTranscodedDir, { recursive: true });
        const tempFilePath = path.join(
          tempTranscodedDir,
          path.basename(sourceKey)
        );
        await fs.promises.writeFile(tempFilePath, bodyData);

        const commands = [];
        let masterPlaylist = "#EXTM3U\n#EXT-X-VERSION:3\n";

        for (const resolution of videoResolutions) {
          const outputDir = path.join(tempTranscodedDir, resolution.name);
          await fs.promises.mkdir(outputDir, { recursive: true });
          const outputPath = path.join(outputDir, `${resolution.name}.m3u8`);

          const gpu = await isGPUAvailable();

          let ffmpegCommand: string;

          if (gpu) {
            console.log("GPU is available, transcoding with GPU");
            ffmpegCommand = `ffmpeg -hwaccel cuda -i ${tempFilePath} -vf "scale=${resolution.width}:${resolution.height}" -c:v h264_nvenc -b:v ${resolution.bitrate} -c:a aac -strict -2 -f hls -hls_time 10 -hls_list_size 0 -hls_segment_filename ${outputDir}/%03d.ts ${outputPath}`;
          } else {
            console.log("GPU is not available, transcoding with CPU");
            ffmpegCommand = `ffmpeg -i ${tempFilePath} -vf "scale=${resolution.width}:${resolution.height}" -c:v libx264 -b:v ${resolution.bitrate} -c:a aac -strict -2 -f hls -hls_time 10 -hls_list_size 0 -hls_segment_filename ${outputDir}/%03d.ts ${outputPath}`;
          }

          const transcodeProcess = spawn(ffmpegCommand, [], { shell: true });

          transcodeProcess.on("exit", (code) => {
            if (code === 0) {
              console.log(`Transcoding completed for ${resolution.name}`);
            } else {
              console.error(
                `Error during transcoding for ${resolution.name}. Exit code: ${code}`
              );
            }
          });

          transcodeProcess.stderr.on("data", (data) => {
            console.error(`ffmpeg stderr: ${data}`);
          });

          commands.push(transcodeProcess);
          masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${
            parseInt(resolution.bitrate) * 1000
          },RESOLUTION=${resolution.width}x${resolution.height}\n${
            resolution.name
          }/${resolution.name}.m3u8\n`;
        }

        await Promise.all(
          commands.map(
            (process) =>
              new Promise((resolve, reject) => {
                process.on("exit", resolve);
                process.on("error", reject);
              })
          )
        );

        const masterPlaylistPath = path.join(tempTranscodedDir, "master.m3u8");
        await fs.promises.writeFile(masterPlaylistPath, masterPlaylist);

        const uploads = [
          ...videoResolutions.map((resolution) => {
            const playlistPath = path.join(
              tempTranscodedDir,
              resolution.name,
              `${resolution.name}.m3u8`
            );
            const uploadParams = {
              Bucket: bucketName,
              Key: `${destKey}/${resolution.name}/${resolution.name}.m3u8`,
              Body: createReadStream(playlistPath),
              ContentType: "application/x-mpegURL",
            };
            const uploadCommand = new PutObjectCommand(uploadParams);
            return s3Client.send(uploadCommand);
          }),
          ...videoResolutions.flatMap((resolution) => {
            const segmentsDir = path.join(tempTranscodedDir, resolution.name);
            const segmentFiles = fs
              .readdirSync(segmentsDir)
              .filter((file) => file.endsWith(".ts"));
            return segmentFiles.map((file) => {
              const filePath = path.join(segmentsDir, file);
              const uploadParams = {
                Bucket: bucketName,
                Key: `${destKey}/${resolution.name}/${file}`,
                Body: createReadStream(filePath),
                ContentType: "video/MP2T",
              };
              const uploadCommand = new PutObjectCommand(uploadParams);
              return s3Client.send(uploadCommand);
            });
          }),
        ];

        const masterUploadParams = {
          Bucket: bucketName,
          Key: `${destKey}/master.m3u8`,
          Body: createReadStream(masterPlaylistPath),
          ContentType: "application/x-mpegURL",
        };
        const masterUpload = s3Client.send(
          new PutObjectCommand(masterUploadParams)
        );

        await Promise.all([masterUpload, ...uploads]);
        console.log("Files uploaded to S3 successfully");

        const et = new Date().getTime();
        console.log(`Transcoding and upload took ${et - st} ms`);
      } catch (err) {
        console.error("Error during transcoding and upload:", err);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    };

    await transcodeVideo(sourceBucket, sourceKey, destKey);
    await deleteMessage(message_info.receiptHandle);
  } catch (error) {
    console.error("Error in transcodeVideo function:", error);
  }
};

main();
