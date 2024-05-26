const { MediaConvert } = require("@aws-sdk/client-mediaconvert");
const { S3 } = require("@aws-sdk/client-s3");
const { SNS } = require("@aws-sdk/client-sns");

const writeManifest = async (bucket, manifestFile, jobDetails) => {
  let results = {};
  try {
    const s3 = new S3();

    console.log(`Reading jobs-manifest.json from ${bucket}`);

    let manifest = await s3.getObject({
      Bucket: bucket,
      Key: manifestFile,
    });

    manifest = JSON.parse(await manifest.Body.transformToString());

    if (jobDetails.detail) {
      console.log(`Writting input info for ${jobDetails.detail.jobId}`);
      manifest.Jobs.push({
        Id: jobDetails.detail.jobId,
        InputDetails: jobDetails.detail.inputDetails[0],
        InputFile: jobDetails.detail.inputDetails[0].uri,
      });
    } else {
      console.log(`Writting jobDetails for ${jobDetails.Id}`);
      const index = manifest.Jobs.findIndex((job) => job.Id === jobDetails.Id);
      if (index === -1) {
        console.log(
          `no entry found for jobId: ${jobDetails.Id}, creating new entry`
        );
        jobDetails.InputDetails = {};
        manifest.Jobs.push(jobDetails);
        results = jobDetails;
      } else {
        results = { ...manifest.Jobs[index], ...jobDetails };
        manifest.Jobs[index] = results;
      }
    }
    await s3.putObject({
      Bucket: bucket,
      Key: manifestFile,
      Body: JSON.stringify(manifest),
    });
  } catch (err) {
    const error = new Error(
      "Failed to update the jobs-manifest.json, please check its accessible in the root of the source S3 bucket"
    );
    error.Error = err;
    error.Job = jobDetails;
    console.error(error);
    throw error;
  }
  return results;
};

const processJobDetails = async (endpoint, cloudfrontUrl, data) => {
  console.log("Processing MediaConvert outputs");
  const buildUrl = (originalValue) =>
    originalValue.slice(5).split("/").splice(1).join("/");
  const mediaconvert = new MediaConvert({
    endpoint: endpoint,
    customUserAgent: process.env.SOLUTION_IDENTIFIER,
  });
  let jobDetails = {};

  try {
    const jobData = await mediaconvert.getJob({ Id: data.detail.jobId });

    jobDetails = {
      Id: data.detail.jobId,
      Job: jobData.Job,
      OutputGroupDetails: data.detail.outputGroupDetails,
      Outputs: {
        HLS_GROUP: [],
        DASH_ISO_GROUP: [],
        CMAF_GROUP: [],
        MS_SMOOTH_GROUP: [],
        FILE_GROUP: [],
        THUMB_NAILS: [],
      },
    };

    data.detail.outputGroupDetails.forEach((output) => {
      if (output.type != "FILE_GROUP") {
        jobDetails.Outputs[output.type].push(
          `https://${cloudfrontUrl}/${buildUrl(output.playlistFilePaths[0])}`
        );
      } else {
        if (
          output.outputDetails[0].outputFilePaths[0].split(".").pop() === "jpg"
        ) {
          jobDetails.Outputs.THUMB_NAILS.push(
            `https://${cloudfrontUrl}/${buildUrl(
              output.outputDetails[0].outputFilePaths[0]
            )}`
          );
        } else {
          output.outputDetails.forEach((filePath) => {
            jobDetails.Outputs.FILE_GROUP.push(
              `https://${cloudfrontUrl}/${buildUrl(
                filePath.outputFilePaths[0]
              )}`
            );
          });
        }
      }
    });
    for (const output in jobDetails.Outputs) {
      if (jobDetails.Outputs[output] < 1) delete jobDetails.Outputs[output];
    }
  } catch (err) {
    throw err;
  }
  console.log(`JOB DETAILS:: ${JSON.stringify(jobDetails, null, 2)}`);
  return jobDetails;
};

const sendSns = async (topic, status, data) => {
  const sns = new SNS({
    region: process.env.REGION,
  });
  try {
    let id, msg;

    switch (status) {
      case "COMPLETE":
        id = data.Id;
        msg = {
          Id: data.Id,
          InputFile: data.InputFile,
          InputDetails: data.InputDetails,
          Outputs: data.Outputs,
        };
        break;
      case "CANCELED":
      case "ERROR":
        id = data.detail.jobId;
        msg = {
          Details: `https://console.aws.amazon.com/mediaconvert/home?region=${process.env.AWS_REGION}#/jobs/summary/${id}`,
          ErrorMsg: data,
        };
        break;
      case "PROCESSING ERROR":
        id = data.Job.detail.jobId || data.detail.jobId;
        msg = data;
        break;
    }
    console.log(`Sending ${status} SNS notification ${id}`);

    await sns.publish({
      TargetArn: topic,
      Message: JSON.stringify(msg, null, 2),
      Subject: `Job ${status} id:${id}`,
    });
  } catch (err) {
    console.error(err);
    throw err;
  }
};

module.exports = {
  writeManifest: writeManifest,
  processJobDetails: processJobDetails,
  sendSns: sendSns,
};
