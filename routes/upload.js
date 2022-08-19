var express = require("express");
var router = express.Router();
var yauzl = require("yauzl");
const serverDir = process.env.ACSERVER_DIR
  ? process.env.ACSERVER_DIR
  : "../serverfiles";
var path = require("path");
var Transform = require("stream").Transform;

var fs = require("fs");

router.post("/", async function (req, res, next) {
  console.log(req.body);
  if (
    req.file &&
    req.body.type &&
    (req.body.type == "car" || req.body.type == "track")
  ) {
    try {
      //  fs.rmSync(
      //   `${serverDir}/content/${req.body.type}s/${
      //     req.file.filename.split(".")[0]
      //   }`,
      //   {
      //     recursive: true,
      //     force: true,
      //   }
      // );

      function handleZipFile(err, zipfile) {
        if (err) throw err;

        // track when we've closed all our file handles
        var handleCount = 0;
        function incrementHandleCount() {
          handleCount++;
        }
        function decrementHandleCount() {
          handleCount--;
          if (handleCount === 0) {
            console.log("all input and output handles closed");
          }
        }
        function mkdirp(dir, cb) {
          if (dir === ".") return cb();
          fs.stat(dir, function (err) {
            if (err == null) return cb(); // already exists

            var parent = path.dirname(dir);
            mkdirp(parent, function () {
              process.stdout.write(dir.replace(/\/$/, "") + "/\n");
              fs.mkdir(dir, cb);
            });
          });
        }
        incrementHandleCount();
        zipfile.on("close", function () {
          console.log("closed input file");
          decrementHandleCount();
        });

        zipfile.readEntry();
        zipfile.on("entry", function (entry) {
          if (
            /\/$/.test(
              `${serverDir}/content/${req.body.type}s/${entry.fileName}`
            )
          ) {
            // directory file names end with '/'
            mkdirp(
              `${serverDir}/content/${req.body.type}s/${entry.fileName}`,
              function () {
                if (err) throw err;
                zipfile.readEntry();
              }
            );
          } else {
            // ensure parent directory exists
            mkdirp(
              path.dirname(
                `${serverDir}/content/${req.body.type}s/${entry.fileName}`
              ),
              function () {
                zipfile.openReadStream(entry, function (err, readStream) {
                  if (err) throw err;
                  // report progress through large files
                  var byteCount = 0;
                  var totalBytes = entry.uncompressedSize;
                  var lastReportedString =
                    byteCount + "/" + totalBytes + "  0%";
                  process.stdout.write(
                    `${serverDir}/content/${req.body.type}s/${entry.fileName}` +
                      "..." +
                      lastReportedString
                  );
                  function reportString(msg) {
                    var clearString = "";
                    for (var i = 0; i < lastReportedString.length; i++) {
                      clearString += "\b";
                      if (i >= msg.length) {
                        clearString += " \b";
                      }
                    }
                    process.stdout.write(clearString + msg);
                    lastReportedString = msg;
                  }
                  // report progress at 60Hz
                  var progressInterval = setInterval(function () {
                    reportString(
                      byteCount +
                        "/" +
                        totalBytes +
                        "  " +
                        (((byteCount / totalBytes) * 100) | 0) +
                        "%"
                    );
                  }, 1000 / 60);
                  var filter = new Transform();
                  filter._transform = function (chunk, encoding, cb) {
                    byteCount += chunk.length;
                    cb(null, chunk);
                  };
                  filter._flush = function (cb) {
                    clearInterval(progressInterval);
                    reportString("");
                    // delete the "..."
                    process.stdout.write("\b \b\b \b\b \b\n");
                    cb();
                    zipfile.readEntry();
                  };

                  // pump file content
                  var writeStream = fs.createWriteStream(
                    `${serverDir}/content/${req.body.type}s/${entry.fileName}`
                  );
                  incrementHandleCount();
                  writeStream.on("close", decrementHandleCount);
                  readStream.pipe(filter).pipe(writeStream);
                });
              }
            );
          }
        });
      }

      await fs.mkdirSync(
        `${serverDir}/content/${req.body.type}s/${
          req.file.filename.split(".")[0]
        }`
      );

      await yauzl.open(
        `${serverDir}/content/uploads/${req.file.filename}`,
        { lazyEntries: true },
        handleZipFile
      );
    } catch (e) {
      console.log("error", e);
    }
  }
  res.send("respond with a resource");
});

module.exports = router;
