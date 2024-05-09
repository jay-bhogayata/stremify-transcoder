import { ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

const client = new SQSClient({});
const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;
if (!SQS_QUEUE_URL) {
  console.error("SQS_QUEUE_URL is not defined");
  process.exit(1);
}

const receiveMessage = async (queueUrl: string) => {
  try {
    return await client.send(
      new ReceiveMessageCommand({
        MaxNumberOfMessages: 10,
        MessageAttributeNames: ["All"],
        QueueUrl: queueUrl,
      })
    );
  } catch (error) {
    console.error("Error receiving message: ", error);
    throw error;
  }
};

export const sqsRun = async (queueUrl: string = SQS_QUEUE_URL) => {
  if (!/^https?:\/\/[^ "]+$/.test(queueUrl)) {
    console.error("Invalid queue URL");
    return;
  }

  const { Messages } = await receiveMessage(queueUrl);

  if (!Messages || Messages.length === 0) {
    console.log("No Messages Received");
    return;
  }

  console.log("Messages Received: ", Messages.length);

  for (const m of Messages) {
    try {
      const msg = m.Body || "";
      const msgObj = JSON.parse(msg);
      const aa = JSON.parse(msgObj.Message);

      if (aa.Records && aa.Records[0] && aa.Records[0].s3) {
        console.log(aa);
        console.log("Bucket Name: ", aa.Records[0].s3.bucket.name);
        console.log("Object Key: ", aa.Records[0].s3.object.key);
      } else {
        console.error("Invalid message format");
      }
    } catch (error) {
      console.error("Error processing message: ", error);
    }
  }
};
