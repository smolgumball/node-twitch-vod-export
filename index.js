let VOD_ID;
if (parseInt(process.argv[2]) >= 10) {
  VOD_ID = parseInt(process.argv[2]);
} else {
  throw "Provided VOD ID is invalid";
}

// Config management
require("dotenv-flow").config();

// Libs
const async = require("async");
const execa = require("execa");
const got = require("got");
const fs = require("fs");

// Local config
const NUM_TO_DOWNLOAD_PARALLEL = 10;
const TMP_PATH = "./tmp/"; // NOTE: Include trailing slash

// TODO: Modularize this "script"
(async () => {
  const VOD_TOKEN = await getVodToken(VOD_ID);
  const VOD_TS_URLS = await getTsMeta(VOD_ID, VOD_TOKEN);

  let partsToGet = VOD_TS_URLS;
  // Grab ten TS parts
  // let partsToGet = VOD_TS_URLS.slice(32, 45);
  console.log(
    `🏎 Beginning download of ${
      partsToGet.length
    } VOD TS parts, ${NUM_TO_DOWNLOAD_PARALLEL} at a time, to ./tmp`
  );
  await retrieveTsParts(VOD_ID, partsToGet, TMP_PATH);

  console.log(
    `✅ Finished download of ${partsToGet.length} VOD TS parts to ./tmp`
  );

  // Build a "manifest" file to be used by FFMPEG when
  // concatenating TS parts together
  let vodConcatManifest = [];
  partsToGet.forEach((url, index) => {
    vodConcatManifest.push(`file '${VOD_ID}-${url.split("/chunked/")[1]}'`);
  });

  // Check for muted part at index 0 and reprocess if needed.
  // Reprocessing requires adding silent audio to the muted track,
  // then flipping stream indexes so audio in slot 0 and video in slot 1.
  // TODO: Burn it with fire
  if (vodConcatManifest[0].indexOf("-muted") != -1) {
    try {
      console.log("Unmuting first TS part");

      let partPath = `${TMP_PATH}${vodConcatManifest[0]
        .replace("file ", "")
        .replace(/'/g, "")}`;
      await execa("ffmpeg", [
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-i",
        `${partPath}`,
        "-shortest",
        "-c:a",
        "aac",
        "-c:v",
        "copy",
        "-y",
        `${partPath.replace("-muted", "-unmuted")}`
      ]);
      await execa("ffmpeg", [
        "-i",
        `${partPath.replace("-muted", "-unmuted")}`,
        "-map",
        "0:1",
        "-map",
        "0:0",
        "-c",
        "copy",
        "-y",
        `${partPath.replace("-muted", "-unmuted-flipped")}`
      ]);
      vodConcatManifest[0] = vodConcatManifest[0].replace(
        "-muted",
        "-unmuted-flipped"
      );
      console.log("First TS part unmuted");
    } catch (error) {
      console.log(error);
    }
  }

  // Write concat manifest to file
  fs.writeFileSync(
    `${TMP_PATH}${VOD_ID}-concat-manifest.txt`,
    vodConcatManifest.join("\n")
  );
  console.log(`🖹 FFMPEG concat manifest prepared`);

  // Concat parts using FFMPEG
  console.log(`🔬 Assembling TS parts`);
  try {
    await execa("ffmpeg", [
      "-f",
      "concat",
      "-i",
      `${TMP_PATH}${VOD_ID}-concat-manifest.txt`,
      "-c",
      "copy",
      "-y",
      `${TMP_PATH}${VOD_ID}.mp4`
    ]);
    console.log(`🏗 TS parts assembled into ${TMP_PATH}${VOD_ID}.mp4`);
  } catch (error) {
    console.log(error);
  }
})();

async function retrieveTsParts(vodId, vodTsUrls, tmpPath) {
  return new Promise(resolve => {
    async.eachOfLimit(
      vodTsUrls,
      NUM_TO_DOWNLOAD_PARALLEL,
      (vodUrl, index, callback) => {
        let remoteFilename = vodUrl.split("/chunked/")[1];
        let filePath = `${tmpPath}${vodId}-${remoteFilename}`;
        try {
          got.stream(vodUrl).pipe(
            fs.createWriteStream(filePath).on("close", () => {
              console.log(`👉 Done downloading TS part #${index + 1}`);
              callback();
            })
          );
        } catch (error) {
          console.log(`Error with TS part download ${filePath}`);
        }
      },
      err => {
        if (err) {
          console.log(`Error when downloading VOD TS parts`, err);
        }
        resolve();
      }
    );
  });
}

/**
 * Retrieve an access token for a particular VOD on Twitch. This access token
 * is used to request further metadata from Twitch's streaming servers.
 * @param {String} vodId ID of a VOD on Twitch
 */
async function getVodToken(vodId) {
  // TOKEN_PATTERN
  // "https://api.twitch.tv/api/vods/{vod_id}/access_token"
  let query = new URLSearchParams([
    ["client_id", process.env.TWITCH_CLIENT_ID]
  ]);

  try {
    let res = await got(
      `https://api.twitch.tv/api/vods/${vodId}/access_token`,
      { query, json: true }
    );
    return res.body;
  } catch (error) {
    console.error("Something went wrong w/ the VOD token retrieval");
    console.error(error);
  }
}

/**
 * Lookup transport stream metadata for a Twitch VOD, and return a
 * list of URLS for all TS parts belonging to the VOD.
 *
 * @param {String} vodId ID of a VOD on Twitch
 * @param {String} vodToken VOD stream token retrieved from Twitch
 * @param {String} userAgent User-Agent to be used when requesting transport stream metadata. Defaults to a Windows 10, Chrome install.
 */
async function getTsMeta(vodId, vodToken, userAgent) {
  let query = new URLSearchParams([
    ["client_id", process.env.TWITCH_CLIENT_ID],
    ["token", vodToken.token],
    ["sig", vodToken.sig],
    ["allow_source", "true"]
  ]);
  userAgent =
    userAgent ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
    AppleWebKit/537.36 (KHTML, like Gecko) \
    Chrome/75.0.3770.142 Safari/537.36";

  try {
    let res = await got(`https://usher.ttvnw.net/vod/${vodId}.m3u8`, {
      query,
      headers: {
        ["Accept"]: "application/vnd.apple.mpegurl",
        ["User-Agent"]: userAgent
      }
    });
    return _getTsUrlsFromTsIndex(res.body);
  } catch (error) {
    console.error("Something went wrong w/ the VOD transport stream retrieval");
    console.error(error);
  }
}

/**
 * Use information provided by transport stream metadata to build a
 * list of all TS parts belonging to a given Twitch VOD.
 *
 * @param {String} tsMeta Transport stream metadata retrieved from a Twitch m3u8 file
 */
async function _getTsUrlsFromTsIndex(tsMeta) {
  let splitMeta = tsMeta.split("\n");

  // Find location of main video descriptor
  let videoProgramIndex = splitMeta.findIndex(
    item => item.indexOf('VIDEO="chunked"') !== -1
  );

  // Grab meta URL from just below the descriptor line
  let videoProgramMetaUrl = splitMeta[videoProgramIndex + 1];

  // Grab meta file
  let videoProgramMeta = await _getFile(videoProgramMetaUrl);

  // Reuse the meta URL for individual TS parts, stripping off the index filename
  let vodUrlPattern = videoProgramMetaUrl.split("/chunked/")[0] + "/chunked";

  // Build a list of all TS parts for this VOD
  let programMetaLines = videoProgramMeta.split("\n");
  let vodUrls = [];
  programMetaLines.forEach((item, index) => {
    if (item.indexOf("#EXTINF:") !== -1) {
      vodUrls.push(`${vodUrlPattern}/${programMetaLines[index + 1]}`);
    }
  });

  return vodUrls;
}

/**
 * Download a file and return the `body`.
 *
 * @param {String} url Url of file to make a GET request for
 */
async function _getFile(url) {
  try {
    let res = await got(url);
    return res.body;
  } catch (error) {
    console.error("Something went wrong w/ plain text file retrieval");
    console.error(error);
  }
}

// VOD_M3U8_PATTERN
// "https://usher.ttvnw.net/vod/{vod_id}.m3u8"

// VOD_ID
// 457049520

// process.env.TWITCH_CLIENT_ID

/*

1) Load Twitch player in headless Chrome to get vod-metro CDN info for video
`https://www.twitch.tv/videos/${vod_id}`

2) Get parts meta from vod-metro CDN
e.g. vod_metro_id = `b49937e12a2d2a5b7e2d_jyoriekken_35019243024_1257373027`
`https://vod-metro.twitch.tv/${vod_metro_id}/chunked/index-dvr.m3u8`

    * This returns something like:

        #EXTM3U
        #EXT-X-VERSION:3
        #EXT-X-TARGETDURATION:13
        #ID3-EQUIV-TDTG:2019-07-23T23:58:59
        #EXT-X-PLAYLIST-TYPE:EVENT
        #EXT-X-MEDIA-SEQUENCE:0
        #EXT-X-TWITCH-ELAPSED-SECS:0.000
        #EXT-X-TWITCH-TOTAL-SECS:3311.333
        #EXTINF:12.500,
        0.ts
        #EXTINF:12.500,
        1.ts
        #EXTINF:12.500,
        2.ts
        ...
        #EXTINF:10.333,
        264.ts
        #EXTINF:1.000,
        265.ts
        #EXT-X-ENDLIST

    * Parse this metadata, get the number of parts.

3) Get *.ts parts from Twitch w/ some amount of parallelism
`https://vod-metro.twitch.tv/${vod_metro_id}/chunked/${vod_part_index}.ts`

4) Concate parts from Twitch
`ffmpeg -i concatted.ts -acodec copy -vcodec copy output.mp4`

*/
