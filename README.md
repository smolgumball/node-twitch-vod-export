# node-twitch-vod-export
Export Twitch VODs to .mp4 using your Twitch client ID, Node.js and ffmpeg

# Requirements

* Node.js, v12.x or higher
* yarn package manager (`npm i -g yarn`)
* `ffmpeg` binary, v4.1.x or higher, installed on local machine
* A Twitch client ID. [Set one up](https://dev.twitch.tv/console) on the Twitch developers site 📗
* Only tested on Ubuntu 19.x, should work (at least) on MacOS as well, if not Windows

# Usage

1. Run `yarn` to install
2. Rename `.env.local.example` to `.env.local`, provide your Twitch client ID
3. Run `node index.js [VOD_ID]` to download a VOD to the `tmp/` dir

# Example

```bash
node index.js 457488243 # => download VOD parts, and then assemble into tmp/457488243.mp4
```
