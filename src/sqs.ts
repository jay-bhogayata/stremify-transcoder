import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";

const client = new SQSClient({
  region: process.env.AWS_REGION,
});

const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;
if (!SQS_QUEUE_URL) {
  console.error("SQS_QUEUE_URL is not defined");
  process.exit(1);
}

export const deleteMessage = async (receiptHandle: string | undefined) => {
  try {
    const input = {
      QueueUrl: SQS_QUEUE_URL,
      ReceiptHandle: receiptHandle,
    };
    const res = await client.send(new DeleteMessageCommand(input));

    console.log(res);
  } catch (error) {
    console.error(error);
  }
};

const receiveMessage = async (queueUrl: string) => {
  try {
    return await client.send(
      new ReceiveMessageCommand({
        MaxNumberOfMessages: 1,
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
  const { Messages } = await receiveMessage(queueUrl);

  if (Messages == undefined) {
    console.error("Message is not available for processing");
  }

  let ReceiptHandle: string | undefined = "";
  if (Messages !== undefined) {
    console.log(Messages[0]?.ReceiptHandle);
    ReceiptHandle = Messages[0]?.ReceiptHandle;
  } else {
    process.exit(1);
  }

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
        console.log("Bucket Name: ", aa.Records[0].s3.bucket.name);
        console.log("Object Key: ", aa.Records[0].s3.object.key);
      } else {
        console.error("Invalid message format");
      }
      console.log("---------------------------");
      const message_info = {
        bucket: aa.Records[0].s3.bucket.name,
        key: aa.Records[0].s3.object.key,
        receiptHandle: ReceiptHandle,
      };
      return message_info;
    } catch (error) {
      console.error("Error processing message: ", error);
    }
  }
};
