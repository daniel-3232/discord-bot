#!/bin/bash
# Deploy discord bot to GCP e2-micro
# Usage: ./deploy.sh [PROJECT_ID] [ZONE]

set -euo pipefail

PROJECT_ID="${1}"
ZONE="${2:-us-central1-a}"
INSTANCE_NAME="discord-bot"
IMAGE_NAME="discord-bot"
IMAGE_TAG="latest"

# Detect project
if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
  if [[ -z "$PROJECT_ID" ]]; then
    echo "Usage: $0 <PROJECT_ID> [ZONE]"
    exit 1
  fi
fi

echo "Project: $PROJECT_ID"
echo "Zone:    $ZONE"

# 1. Build Docker image
echo "Building Docker image..."
cd discord-bot
docker build -t "$IMAGE_NAME:$IMAGE_TAG" .
cd ..

# 2. Tag for GCP
docker tag "$IMAGE_NAME:$IMAGE_TAG" "gcr.io/$PROJECT_ID/$IMAGE_NAME:$IMAGE_TAG"

# 3. Push to Container Registry
echo "Pushing to gcr.io/$PROJECT_ID/$IMAGE_NAME:$IMAGE_TAG..."
docker push "gcr.io/$PROJECT_ID/$IMAGE_NAME:$IMAGE_TAG"

# 4. Create VM if not exists
if ! gcloud compute instances describe "$INSTANCE_NAME" --zone="$ZONE" --project="$PROJECT_ID" &>/dev/null; then
  echo "Creating e2-micro VM..."
  gcloud compute instances create-with-container "$INSTANCE_NAME" \
    --zone="$ZONE" \
    --machine-type=e2-micro \
    --container-image="gcr.io/$PROJECT_ID/$IMAGE_NAME:$IMAGE_TAG" \
    --container-restart-policy=always \
    --container-env-file="discord-bot/.env" \
    --tags=http-server \
    --metadata=google-logging-enabled=true \
    --boot-disk-size=20GB \
    --project="$PROJECT_ID"
else
  echo "VM exists, updating container..."
  gcloud compute instances update-container "$INSTANCE_NAME" \
    --zone="$ZONE" \
    --container-image="gcr.io/$PROJECT_ID/$IMAGE_NAME:$IMAGE_TAG" \
    --project="$PROJECT_ID"
fi

echo "Done! Bot is deploying to $INSTANCE_NAME in $ZONE."
echo "Check logs: gcloud compute ssh $INSTANCE_NAME --zone=$ZONE -- docker logs discord-bot"
