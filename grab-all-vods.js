const latestVods = require("./latest-vods.json").data;
const async = require("async");
const execa = require("execa");

async.eachOfLimit(
  latestVods,
  2,
  (vodMeta, index, callback) => {
    let subprocess = execa(`node`, ["index.js", vodMeta.id]);
    subprocess.stdout.pipe(process.stdout);
    (async () => {
      await subprocess;
      callback();
    })();
  },
  err => {
    if (err) {
      console.log(`Error when running VOD grabber`, err);
    }
  }
);
