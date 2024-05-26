const { v4: uuidv4 } = require("uuid");
const {
  getJobSettings,
  updateJobSettings,
  createJob,
  sendError,
} = require("./util");

exports.handler = async function (event, context) {
  console.log(context.LogGroupName);

  console.log(`REQUEST:: ${JSON.stringify(event, null, 2)}`);

  const MEDIACONVERT_ENDPOINT =
    "https://idej2gpma.mediaconvert.ap-south-1.amazonaws.com";

  const { MEDIACONVERT_ROLE, JOB_SETTINGS, DESTINATION_BUCKET, SNS_TOPIC_ARN } =
    process.env;

  try {
    const srcVideo = decodeURIComponent(
      event.Records[0].s3.object.key.replace(/\+/g, " ")
    );

    const srcBucket = decodeURIComponent(event.Records[0].s3.bucket.name);

    const settingsFile = `${srcVideo.split("/")[0]}/${JOB_SETTINGS}`;

    const guid = uuidv4();
    const inputPath = `s3://${srcBucket}/${srcVideo}`;

    const outputPath = `s3://${DESTINATION_BUCKET}/${guid}`;

    const metaData = {
      Guid: guid,
    };

    let job = await getJobSettings(srcBucket, settingsFile);

    job = await updateJobSettings(
      job,
      inputPath,
      outputPath,
      metaData,
      MEDIACONVERT_ROLE
    );

    await createJob(job, MEDIACONVERT_ENDPOINT);
  } catch (err) {
    await sendError(SNS_TOPIC_ARN, context.logGroupName, err);
    throw err;
  }
  return;
};
