import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createReadStream, createWriteStream } from "fs";

const sourceBucket = process.env.BUCKET_NAME || "stremify-master-vod-bucket";
const sourceKey = process.env.SOURCE_KEY || "test.mp3";
const destKey = path.basename(sourceKey, path.extname(sourceKey));

const s3Client = new S3Client({
  region: "ap-south-1",
});
const bucketName = "stremify-vod-prod";
// use cwd for temp dir
const tempDir = path.join(process.cwd(), "temp");
const tempTranscodedDir = path.join(tempDir, "transcoded");
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
    const videoStream = await s3Client
      .send(getObjectCommand)
      .then(({ Body }) => Body);

    await fs.promises.mkdir(tempTranscodedDir, { recursive: true });
    const tempFilePath = path.join(tempTranscodedDir, path.basename(sourceKey));
    console.log(tempFilePath);

    const writeStream = createWriteStream(tempFilePath);
    videoStream?.transformToByteArray().then((data: any) => {
      writeStream.write(data);
      writeStream.end();
    });

    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    const commands = [];
    let masterPlaylist = "#EXTM3U\n#EXT-X-VERSION:3\n";

    for (const resolution of videoResolutions) {
      const outputDir = path.join(tempTranscodedDir, resolution.name);
      await fs.promises.mkdir(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, `${resolution.name}.m3u8`);

      // if gpu is not available
      const ffmpegCommand = `ffmpeg -i ${tempFilePath} -vf "scale=${resolution.width}:${resolution.height}" -c:v libx264 -b:v ${resolution.bitrate} -c:a aac -strict -2 -f hls -hls_time 10 -hls_list_size 0 -hls_segment_filename ${outputDir}/%03d.ts ${outputPath}`;

      // if gpu is available
      // const ffmpegCommand = `ffmpeg -hwaccel cuda -i ${tempFilePath} -vf "scale=${resolution.width}:${resolution.height}" -c:v h264_nvenc -b:v ${resolution.bitrate} -c:a aac -strict -2 -f hls -hls_time 10 -hls_list_size 0 -hls_segment_filename ${outputDir}/%03d.ts ${outputPath}`;

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

    // Upload the master playlist
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
  } catch (err) {
    console.error("Error during transcoding and upload:", err);
  }

  const et = new Date().getTime();
  console.log(`Transcoding and upload took ${et - st} ms`);
};

transcodeVideo(sourceBucket, sourceKey, destKey)
  .then(() => {
    console.log("Transcoding and upload complete");
  })
  .catch((err) => {
    console.error("Error during transcoding and upload:", err);
  })
  .finally(() => {
    fs.rmSync(tempDir, { recursive: true });
  });
