# syntax=docker/dockerfile:1

# Comments are provided throughout this file to help you get started.
# If you need more help, visit the Dockerfile reference guide at
# https://docs.docker.com/engine/reference/builder/

ARG NODE_VERSION=20.15.0

FROM node:${NODE_VERSION}

# Use production node environment by default.
ENV NODE_ENV=development

# RUN apk update && \
#   apk add git

WORKDIR /usr/src/app

# Copy the rest of the source files into the image.
COPY . .

RUN apt-get update

RUN apt-get install -y build-essential cmake clang libssl-dev python3-pip

# image構築後に実施で対応 docker-compose run server yarn install
# RUN NODE_ENV=development yarn install

# Run the application as a non-root user.
USER node


# Expose the port that the application listens on.
EXPOSE 3100


# Run the application.
CMD bash -c 'yarn main & yarn media'
