import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  GetQueueAttributesCommand,
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
  if (!receiptHandle) {
    console.error("No receipt handle provided");
    return;
  }

  try {
    const input = {
      QueueUrl: SQS_QUEUE_URL,
      ReceiptHandle: receiptHandle,
    };
    const res = await client.send(new DeleteMessageCommand(input));
    console.log("Message deleted:", res);
  } catch (error) {
    console.error("Error deleting message:", error);
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
    console.error("Error receiving message:", error);
    throw error;
  }
};

export const sqsRun = async (queueUrl: string = SQS_QUEUE_URL) => {
  try {
    const { Messages } = await receiveMessage(queueUrl);

    if (!Messages || Messages.length === 0) {
      console.log("No messages received");
      return null;
    }

    const message = Messages[0];
    const receiptHandle = message.ReceiptHandle;
    const body = message.Body || "";

    let messageInfo = null;
    try {
      const msgObj = JSON.parse(body);
      const aa = JSON.parse(msgObj.Message);
      if (aa.Records && aa.Records[0] && aa.Records[0].s3) {
        console.log("Bucket Name:", aa.Records[0].s3.bucket.name);
        console.log("Object Key:", aa.Records[0].s3.object.key);

        messageInfo = {
          bucket: aa.Records[0].s3.bucket.name,
          key: aa.Records[0].s3.object.key,
          receiptHandle,
        };
      } else {
        console.error("Invalid message format");
      }
    } catch (error) {
      console.error("Error parsing message:", error);
    }

    return messageInfo;
  } catch (error) {
    console.error("Error in sqsRun function:", error);
    throw error;
  }
};

export async function getQueueLength() {
  try {
    const response = await client.send(
      new GetQueueAttributesCommand({
        QueueUrl: SQS_QUEUE_URL,
        AttributeNames: ["ApproximateNumberOfMessages"],
      })
    );
    return parseInt(
      response.Attributes?.ApproximateNumberOfMessages || "0",
      10
    );
  } catch (error) {
    console.error(`Failed to get queue length: ${error}`);
    return null;
  }
}
