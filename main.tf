# Configure Terraform providers and backend
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.0"
    }
  }

  backend "s3" {
    bucket         = "stremify-tfstate"
    key            = "state/terraform.tfstate"
    region         = "ap-south-1"
    encrypt        = true
    dynamodb_table = "stremify-tfstate-lock"
  }
}

provider "aws" {
  region = "ap-south-1"
}

# Fetch AWS account and region information
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

# S3 buckets
resource "aws_s3_bucket" "stremify-logs" {
  bucket        = "stremify-logs"
  force_destroy = true

  tags = {
    app = "stremify"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "sse-log" {
  bucket = aws_s3_bucket.stremify-logs.bucket

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket" "stremify-raw-vod-store" {
  bucket        = "stremify-raw-vod-store"
  force_destroy = true

  tags = {
    app = "stremify"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "sse-raw-vod" {
  bucket = aws_s3_bucket.stremify-raw-vod-store.bucket

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_logging" "raw-vod-logs" {
  bucket        = aws_s3_bucket.stremify-raw-vod-store.bucket
  target_bucket = aws_s3_bucket.stremify-logs.bucket
  target_prefix = "raw-vod-logs/"
}

resource "aws_s3_bucket_cors_configuration" "cors_for_raw_vods" {
  bucket = aws_s3_bucket.stremify-raw-vod-store.bucket

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "POST", "GET"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
  }
}

resource "aws_s3_bucket" "stremify-master-vod-store" {
  bucket        = "stremify-master-vod-store"
  force_destroy = true

  tags = {
    app = "stremify"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "sse-master-vod" {
  bucket = aws_s3_bucket.stremify-master-vod-store.bucket

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_logging" "master-vod-logs" {
  bucket        = aws_s3_bucket.stremify-master-vod-store.bucket
  target_bucket = aws_s3_bucket.stremify-logs.bucket
  target_prefix = "master-vod-logs/"
}

resource "aws_s3_bucket_cors_configuration" "master-vod-cors" {
  bucket = aws_s3_bucket.stremify-master-vod-store.bucket

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET"]
    allowed_origins = ["*"]
    max_age_seconds = 3000
  }
}

# IAM roles and policies
resource "aws_iam_role" "mediaconvert_role" {
  name = "MediaConvertRole"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "mediaconvert.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_policy" "mediaconvert_policy" {
  name = "MediaConvertPolicy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Effect = "Allow"
        Resource = [
          "${aws_s3_bucket.stremify-raw-vod-store.arn}/*",
          "${aws_s3_bucket.stremify-master-vod-store.arn}/*"
        ]
      },
      {
        Action   = "execute-api:Invoke"
        Effect   = "Allow"
        Resource = "arn:aws:execute-api:*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "mediaconvert_policy_attach" {
  role       = aws_iam_role.mediaconvert_role.name
  policy_arn = aws_iam_policy.mediaconvert_policy.arn
}

resource "aws_iam_role" "job_submit_role" {
  name = "job_submit_lambda_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_policy" "job_submit_policy" {
  name        = "JobSubmitPolicy"
  description = "Policy for Lambda to submit MediaConvert jobs and log to CloudWatch"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.mediaconvert_role.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["mediaconvert:CreateJob"]
        Resource = ["arn:${data.aws_partition.current.partition}:mediaconvert:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:*"]
      },
      {
        Effect = "Allow"
        Action = ["s3:GetObject"]
        Resource = [
          aws_s3_bucket.stremify-raw-vod-store.arn,
          "${aws_s3_bucket.stremify-raw-vod-store.arn}/*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = ["*"]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "job_submit_policy_attachment" {
  role       = aws_iam_role.job_submit_role.name
  policy_arn = aws_iam_policy.job_submit_policy.arn
}

resource "aws_iam_role" "job_complete_role" {
  name = "job_complete_lambda_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_policy" "job_complete_lambda_policy" {
  name        = "JobCompletePolicy"
  description = "Policy for Lambda to handle MediaConvert job complete events"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["mediaconvert:GetJob"]
        Resource = ["*"]
      },
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject"]
        Resource = [
          "${aws_s3_bucket.stremify-master-vod-store.arn}/*",
          "${aws_s3_bucket.stremify-raw-vod-store.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = ["*"]
      },
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = [aws_sns_topic.notification.arn]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "job_complete_policy_attachment" {
  role       = aws_iam_role.job_complete_role.name
  policy_arn = aws_iam_policy.job_complete_lambda_policy.arn
}

# SNS topic
resource "aws_sns_topic" "notification" {
  name = "vod_notification-sns-topic"

  tags = {
    Name = "vod_notification-sns-topic"
  }
}

variable "email_address" {
  type    = string
  default = "jaybhogayata53@gmail.com"
}

resource "aws_sns_topic_subscription" "email_notification" {
  topic_arn = aws_sns_topic.notification.arn
  protocol  = "email"
  endpoint  = var.email_address
}

# Lambda functions
resource "aws_lambda_function" "job_submit_lambda" {
  filename      = "./create-job.zip"
  function_name = "stremify-job-create"
  role          = aws_iam_role.job_submit_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"

  environment {
    variables = {
      MEDIACONVERT_ROLE  = aws_iam_role.mediaconvert_role.arn
      JOB_SETTINGS       = "job-settings.json"
      DESTINATION_BUCKET = aws_s3_bucket.stremify-master-vod-store.bucket
      SNS_TOPIC_ARN      = aws_sns_topic.notification.arn
    }
  }

  tags = {
    Name = "stremify-job-create"
  }
}

resource "aws_lambda_permission" "allow_s3_invoke" {
  statement_id  = "AllowExecutionFromS3"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.job_submit_lambda.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.stremify-raw-vod-store.arn
}

resource "aws_lambda_function" "job_complete_lambda" {
  filename      = "./complete-job.zip"
  function_name = "stremify-job-complete"
  role          = aws_iam_role.job_complete_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"

  environment {
    variables = {
      CLOUDFRONT_DOMAIN = aws_cloudfront_distribution.vod_distribution.domain_name
      SNS_TOPIC_ARN     = aws_sns_topic.notification.arn
      SOURCE_BUCKET     = aws_s3_bucket.stremify-raw-vod-store.bucket
      JOB_MANIFEST      = "jobs-manifest.json"
    }
  }

  tags = {
    Name = "stremify-job-complete"
  }
}

# S3 bucket notifications
resource "aws_s3_bucket_notification" "raw_vod_store_notification" {
  bucket = aws_s3_bucket.stremify-raw-vod-store.bucket

  lambda_function {
    lambda_function_arn = aws_lambda_function.job_submit_lambda.arn
    events              = ["s3:ObjectCreated:*"]
    filter_suffix       = ".mp4"
  }
}

# CloudFront distribution
resource "aws_cloudfront_distribution" "vod_distribution" {
  origin {
    domain_name              = aws_s3_bucket.stremify-master-vod-store.bucket_regional_domain_name
    origin_id                = "vod_origin"
    connection_attempts      = 3
    connection_timeout       = 10
    origin_access_control_id = "EHXR9MY3ZADJI"
  }

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "VOD Distribution"
  default_root_object = "index.html"

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "vod_origin"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    app  = "stremify"
    name = "vod_distribution"
  }
}

resource "aws_s3_bucket_policy" "s3_cfront_policy" {
  bucket = aws_s3_bucket.stremify-master-vod-store.bucket

  policy = jsonencode({
    Version = "2008-10-17"
    Id      = "PolicyForCloudFrontPrivateContent"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.stremify-master-vod-store.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.vod_distribution.arn
          }
        }
      }
    ]
  })
}

# EventBridge rule and target
resource "aws_cloudwatch_event_rule" "vod_job_complete" {
  name        = "vod_job_complete"
  description = "Trigger when MediaConvert job is complete"

  event_pattern = jsonencode({
    "source" : ["aws.mediaconvert"],
    "detail-type" : ["MediaConvert Job State Change"],
    "detail" : {
      "status" : ["COMPLETE", "ERROR", "CANCELED"]
    }
  })
}

resource "aws_cloudwatch_event_target" "job_complete_target" {
  rule      = aws_cloudwatch_event_rule.vod_job_complete.name
  target_id = "vod_job_complete_target"
  arn       = aws_lambda_function.job_complete_lambda.arn
}

resource "aws_lambda_permission" "allow_eventbridge_invoke" {
  statement_id = "AllowExecutionFromEventBridge"
  action       = "lambda:InvokeFunction"


  function_name = aws_lambda_function.job_complete_lambda.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.vod_job_complete.arn
}

# SNS topic subscription for job complete Lambda
resource "aws_sns_topic_subscription" "job_complete_lambda" {
  topic_arn = aws_sns_topic.notification.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.job_complete_lambda.arn
}
