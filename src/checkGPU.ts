import { spawn } from "child_process";

export function isGPUAvailable(): Promise<boolean> {
  const ffmpegProcess = spawn("ffmpeg", ["-hwaccels"]);

  let output = "";
  ffmpegProcess.stdout.on("data", (data) => {
    output += data.toString();
  });

  return new Promise((resolve, reject) => {
    ffmpegProcess.on("close", (code) => {
      if (code !== 0) {
        reject(`ffmpeg exited with code ${code}`);
      } else {
        const gpuAccelMethods = ["cuda", "cuda_cuvid", "nvdec", "qsv"];
        const isGPUAvailable = gpuAccelMethods.some((method) =>
          output.includes(method)
        );
        resolve(isGPUAvailable);
      }
    });

    ffmpegProcess.on("error", (err) => {
      reject(`ffmpeg error: ${err}`);
    });
  });
}
