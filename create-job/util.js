const { MediaConvert } = require("@aws-sdk/client-mediaconvert");
const { S3 } = require("@aws-sdk/client-s3");
const { SNS } = require("@aws-sdk/client-sns");

const getJobSettings = async (bucket, settingsFile) => {
  console.log(
    `Downloading Job Settings file: ${settingsFile}, from S3: ${bucket}`
  );

  let settings;

  try {
    const s3 = new S3();
    settings = await s3.getObject({
      Bucket: bucket,
      Key: settingsFile,
    });
    settings = JSON.parse(await settings.Body.transformToString());
    if (
      !("Settings" in settings) ||
      ("Inputs" in settings && settings.Inputs.length > 1)
    ) {
      throw new Error("Invalid settings file in s3");
    }
  } catch (err) {
    const error = new Error(
      "Failed to download and validate the job-settings.json file. Please check its contents and location."
    );
    error.Error = err.toString();
    throw error;
  }
  return settings;
};

const updateJobSettings = async (
  job,
  inputPath,
  outputPath,
  metadata,
  role
) => {
  console.log(`Updating Job Settings with the source and destination details`);

  const getPath = (group, num) => {
    try {
      let path = "";
      if (group.CustomName) {
        path = `${outputPath}/${group.CustomName.replace(/\s+/g, "")}/`;
      } else {
        path = `${outputPath}/${group.Name.replace(/\s+/g, "")}${num}/`;
      }
      return path;
    } catch (err) {
      throw Error(
        "Cannot validate group name in job.Settings.OutputGroups. Please check your job settings file."
      );
    }
  };
  try {
    let fileNum = 1;
    let hlsNum = 1;
    let dashNum = 1;
    let mssNum = 1;
    let cmafNum = 1;
    job.Settings.Inputs[0].FileInput = inputPath;
    const outputGroups = job.Settings.OutputGroups;
    for (let group of outputGroups) {
      switch (group.OutputGroupSettings.Type) {
        case "FILE_GROUP_SETTINGS":
          group.OutputGroupSettings.FileGroupSettings.Destination = getPath(
            group,
            fileNum++
          );
          break;
        case "HLS_GROUP_SETTINGS":
          group.OutputGroupSettings.HlsGroupSettings.Destination = getPath(
            group,
            hlsNum++
          );
          break;
        case "DASH_ISO_GROUP_SETTINGS":
          group.OutputGroupSettings.DashIsoGroupSettings.Destination = getPath(
            group,
            dashNum++
          );
          break;
        case "MS_SMOOTH_GROUP_SETTINGS":
          group.OutputGroupSettings.MsSmoothGroupSettings.Destination = getPath(
            group,
            mssNum++
          );
          break;
        case "CMAF_GROUP_SETTINGS":
          group.OutputGroupSettings.CmafGroupSettings.Destination = getPath(
            group,
            cmafNum++
          );
          break;
        default:
          throw Error(
            "OutputGroupSettings.Type is not a valid type. Please check your job settings file."
          );
      }
    }

    if (!("AccelerationSettings" in job)) {
      job.AccelerationSettings = "PREFERRED";
    }
    job.Role = role;

    if (job.Queue && job.Queue.split("/").length > 1) {
      job.Queue = job.Queue.split("/")[1];
    }

    job.UserMetadata = { ...job.UserMetadata, ...metadata };
  } catch (err) {
    const error = new Error("Failed to update the job-settings.json file.");
    error.Error = err.toString();
    throw error;
  }
  return job;
};

const createJob = async (job, endpoint) => {
  const mediaconvert = new MediaConvert({
    endpoint: endpoint,
  });
  try {
    await mediaconvert.createJob(job);
    console.log(
      `job subbmited to MediaConvert:: ${JSON.stringify(job, null, 2)}`
    );
  } catch (err) {
    console.error(err);
    throw err;
  }
};

const sendError = async (topic, stackName, logGroupName, err) => {
  console.log(`Sending SNS error notification: ${err}`);
  const sns = new SNS({
    region: process.env.REGION,
  });
  try {
    const msg = {
      Details: `https://console.aws.amazon.com/cloudwatch/home?region=${process.env.AWS_REGION}#logStream:group=${logGroupName}`,
      Error: err,
    };
    await sns.publish({
      TargetArn: topic,
      Message: JSON.stringify(msg, null, 2),
      Subject: `${stackName}: Encoding Job Submit Failed`,
    });
  } catch (err) {
    console.error(err);
    throw err;
  }
};

module.exports = {
  getJobSettings: getJobSettings,
  updateJobSettings: updateJobSettings,
  createJob: createJob,
  sendError: sendError,
};
