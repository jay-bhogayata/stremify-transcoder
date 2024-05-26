const utils = require("./utils.js");

exports.handler = async (event) => {
  console.log(`REQUEST:: ${JSON.stringify(event, null, 2)}`);
  const MEDIACONVERT_ENDPOINT =
    "https://idej2gpma.mediaconvert.ap-south-1.amazonaws.com";

  const { CLOUDFRONT_DOMAIN, SNS_TOPIC_ARN, SOURCE_BUCKET, JOB_MANIFEST } =
    process.env;

  try {
    const status = event.detail.status;

    switch (status) {
      case "INPUT_INFORMATION":
        try {
          await utils.writeManifest(SOURCE_BUCKET, JOB_MANIFEST, event);
        } catch (err) {
          throw err;
        }
        break;
      case "COMPLETE":
        try {
          const jobDetails = await utils.processJobDetails(
            MEDIACONVERT_ENDPOINT,
            CLOUDFRONT_DOMAIN,
            event
          );
          console.log(`JOB DETAILS:: ${JSON.stringify(jobDetails, null, 2)}`);
          const results = await utils.writeManifest(
            SOURCE_BUCKET,
            JOB_MANIFEST,
            jobDetails
          );

          await utils.sendSns(SNS_TOPIC_ARN, status, results);
        } catch (err) {
          throw err;
        }
        break;
      case "CANCELED":
      case "ERROR":
        try {
          await utils.sendSns(SNS_TOPIC_ARN, status, event);
        } catch (err) {
          throw err;
        }
        break;
      default:
        throw new Error("Unknow job status");
    }
  } catch (err) {
    await utils.sendSns(SNS_TOPIC_ARN, "PROCESSING ERROR", err);
    throw err;
  }
  return;
};
