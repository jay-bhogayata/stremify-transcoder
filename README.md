# Serverless VOD processing with AWS Elemental MediaConvert

- This repo contains all the necessary resources to deploy a serverless VOD processing pipeline using AWS Elemental MediaConvert, AWS lambda, AWS eventbridge, AWS sns and AWS s3.


## Architecture

![Architecture](Architecture.png)

## Flow

1. The user uploads a video file to the S3 bucket.
2. The S3 bucket triggers an event that invokes the Lambda function.
3. The Lambda function creates a MediaConvert job to transcode the video file.
4. MediaConvert transcodes the video file and stores the output in the S3 bucket.
5. MediaConvert sends a completion event to EventBridge.
6. EventBridge triggers a Lambda function that sends an SNS notification to the user.

## How to deploy

1. Clone the repository
2. create zip file of the lambda function
   1. go to each lambda function folder and run the following command
   ```
   npm install
   pnpm run zip
   ```
3. configure aws credentials
4. run terraform commands
   ```
   terraform init
   terraform apply
   ```