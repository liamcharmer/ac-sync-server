require("dotenv").config();

var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var multer = require("multer");
var logger = require("morgan");
const fs = require("fs-extra");
const chokidar = require("chokidar");
const serverDir = process.env.ACSERVER_DIR
  ? process.env.ACSERVER_DIR
  : "../serverfiles";
let serverInit = false;
const supabase = require("@supabase/supabase-js");

const database = supabase.createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

let serverId = null;
database
  .from("race_server_tokens")
  .select()
  .eq("server_token", process.env.SERVER_TOKEN)
  .then(async ({ data }) => {
    if (data && data.length > 0) {
      let serverTokenData = data[0];
      let extIP = require("ext-ip")();
      let externalIp = await extIP.get();
      const serverData = {
        server_name: process.env.SERVER_NAME,
        server_description: process.env.SERVER_DESCRIPTION,
        server_port: process.env.SERVER_PORT,
        server_ip: externalIp,
      };
      if (!serverTokenData.server_id) {
        console.log("No server id");
        const insertInfo = await database
          .from("race_server")
          .insert([serverData]);
        serverId = insertInfo.data[0].id;
        const serverTokenInfo = await database
          .from("race_server_tokens")
          .update({ server_id: serverId })
          .match({ id: data[0].id });
        console.log(serverTokenInfo);
      } else {
        serverId = serverTokenData.server_id;
        serverData.id = serverId;
        const insertInfo = await database
          .from("race_server")
          .upsert([serverData]);
      }

      data.server_id = serverId;
      const serverTokenInsert = await database
        .from("race_server_tokens")
        .upsert([data]);
      serverInit = true;
      let cars = await getDirectories(`${serverDir}/content/cars`);
      for (let c = 0; c < cars.length; c++) {
        let car = cars[c];
        carUpload(car, false);
      }
      let tracks = await getDirectories(`${serverDir}/content/tracks`);
      for (let c = 0; c < tracks.length; c++) {
        let track = tracks[c];
        trackUpload(track);
      }
    } else {
      console.log("There is no generated server token");
    }
  });

database
  .from("race_cars")
  .on("DELETE", (payload) => {
    if (payload.eventType == "DELETE") {
      // Need to delete file from server
      let oldData = payload.old;
      fs.rmSync(`${serverDir}/content/cars/${oldData.friendly_id}`, {
        recursive: true,
        force: true,
      });

      console.log(`Deleted Car: ${oldData.friendly_id} from file system`);
    }
  })
  .subscribe();

database
  .from("race_tracks")
  .on("DELETE", (payload) => {
    if (payload.eventType == "DELETE") {
      // Need to delete file from server
      let oldData = payload.old;
      fs.rmSync(`${serverDir}/content/tracks/${oldData.friendly_id}`, {
        recursive: true,
        force: true,
      });
      console.log(`Deleted Track: ${oldData.friendly_id} from file system`);
    }
  })
  .subscribe();

global.watcher = chokidar
  .watch(`.`, {
    persistent: true,
    cwd: `${serverDir}/content`,
    // followSymlinks: false,
    // useFsEvents: false,
    // usePolling: false,
  })
  .on("all", (event, path) => {
    let dataType = path.split("/")[0];
    if (serverInit) {
      console.log(path);
      let folderName = path.split("/")[1];
      if (folderName && !folderName.includes(".")) {
        if (event == "addDir" && path.split("/").length - 1 == 1) {
          console.log(`New Directory Added ${dataType}/${folderName}`);
          setTimeout(() => {
            if (dataType == "cars") {
              carUpload(folderName);
            }
            if (dataType == "tracks") {
              trackUpload(folderName);
            }
          }, 10000);
        }
        if (event == "unlinkDir") {
          console.log(event, path);
          if (dataType == "cars") {
            carRemove(folderName);
          }
          if (dataType == "tracks") {
            trackRemove(folderName);
          }
        }
      }
    }
  })
  .on("ready", () => {
    console.log("Ready");
  });
//.on('raw', console.log.bind(console, 'Raw event:'))

async function trackRemove(track, logs = false) {
  database
    .from("race_tracks")
    .select()
    .match({ server_id: serverId, friendly_id: track })
    .then(async ({ data }) => {
      let track = data[0];
      if (track.main_track) {
        console.log(`${car} has main track ${track.main_track}`);
        await database
          .from("race_tracks")
          .delete()
          .match({ server_id: serverId, id: track.main_track })
          .then(async ({ data, error }) => {
            if (logs) console.log(`${car} main track removed`);
          });
      }
      await database
        .from("race_tracks")
        .delete()
        .match({ server_id: serverId, main_track: track.id })
        .then(async ({ data, error }) => {
          if (logs) console.log(`${car} subs via the main_track removed`);
          database
            .from("race_tracks")
            .delete()
            .match({ server_id: serverId, friendly_id: track.friendly_id })
            .then(async ({ data }) => {
              if (logs) console.log(`${car} removed finally`);
            });
        });
    });
}
async function trackUpload(track, logs = true) {
  let trackInfo = {};
  trackInfo.friendly_id = track;
  trackInfo.name = titleCase(nameifyString(track));
  trackInfo.server_id = serverId;
  if (fs.existsSync(`${serverDir}/content/tracks/${track}/ui/ui_track.json`)) {
    if (logs) console.log(`${track} has ui_track.json`);
    // ...
    let jsonData = await fs.readJson(
      `${serverDir}/content/tracks/${track}/ui/ui_track.json`
    );
    trackInfo.name = jsonData.name;
    trackInfo.description = jsonData.description;
    trackInfo.tags = jsonData.tags;
    trackInfo.country = jsonData.country;
    trackInfo.version = jsonData.version;
    trackInfo.author = jsonData.author;
    trackInfo.city = jsonData.city;
    trackInfo.length = jsonData.length;
    trackInfo.width = jsonData.width;
    trackInfo.pitboxes = jsonData.pixboxes;
    trackInfo.run = jsonData.run;
    trackInfo.geotags = jsonData.geotags;
  }

  let trackVersions = await getDirectories(
    `${serverDir}/content/tracks/${track}/`
  );
  trackVersions = trackVersions.filter(
    (e) => e !== "ui" && e !== "skins" && e !== "data" && e !== "ai"
  );
  if (trackVersions.length > 1) {
    trackInfo.versions = trackVersions;
  }

  database
    .from("race_tracks")
    .select()
    .match({ server_id: serverId, friendly_id: track })
    .then(async ({ data }) => {
      if (data && data.length == 0) {
        const insertTrackInfo = await database
          .from("race_tracks")
          .upsert([trackInfo]);
        if (
          fs.existsSync(`${serverDir}/content/tracks/${track}/ui/outline.png`)
        ) {
          if (logs) console.log(`${track} has a map outline`);
          try {
            const fileContent = fs.readFileSync(
              `${serverDir}/content/tracks/${track}/ui/outline.png`
            );
            let fileName = `${Math.random()}.png`;
            if (trackInfo.friendly_id) {
              fileName = `${trackInfo.friendly_id.toLowerCase()}-outline.png`;
            }
            const filePath = `${fileName}`;
            if (logs) console.log(filePath);
            let { error: uploadError } = await database.storage
              .from("map-outlines")
              .upload(filePath, fileContent);
            if (uploadError) throw uploadError;
            if (logs) console.log("uploaded outline");
          } catch (e) {
            if (logs) console.log(e);
          }
        }
        if (
          fs.existsSync(`${serverDir}/content/tracks/${track}/ui/preview.png`)
        ) {
          if (logs) console.log(`${track} has a map preview`);
          try {
            const previewContent = fs.readFileSync(
              `${serverDir}/content/tracks/${track}/ui/preview.png`
            );
            let previewFileName = `${Math.random()}.png`;
            if (trackInfo.friendly_id) {
              previewFileName = `${trackInfo.friendly_id.toLowerCase()}-preview.png`;
            }
            const previewPath = `${previewFileName}`;
            if (logs) console.log(previewPath);
            let { error: uploadError } = await database.storage
              .from("map-previews")
              .upload(previewPath, previewContent);
            if (uploadError) throw uploadError;
            if (logs) console.log("uploaded preview");
          } catch (e) {
            if (logs) console.log(e);
          }
        }
        if (trackVersions.length > 1) {
          console.log(`${track} has more versions`);
          for (let c = 0; c < trackVersions.length; c++) {
            let subTrackInfo = {};

            subTrackInfo.server_id = serverId;
            let variation = trackVersions[c];
            if (
              fs.existsSync(
                `${serverDir}/content/tracks/${track}/ui/${variation}/ui_track.json`
              )
            ) {
              if (logs) console.log(`${track} ${variation}has ui_track.json`);
              // ...
              let variationJsonData = await fs.readJson(
                `${serverDir}/content/tracks/${track}/ui/${variation}/ui_track.json`
              );
              subTrackInfo.friendly_id = variation;
              subTrackInfo.name = variationJsonData.name;
              subTrackInfo.description = variationJsonData.description;
              subTrackInfo.tags = variationJsonData.tags;
              subTrackInfo.country = variationJsonData.country;
              subTrackInfo.version = variationJsonData.version;
              subTrackInfo.author = variationJsonData.author;
              subTrackInfo.city = variationJsonData.city;
              subTrackInfo.length = variationJsonData.length;
              subTrackInfo.width = variationJsonData.width;
              subTrackInfo.pitboxes = variationJsonData.pixboxes;
              subTrackInfo.run = variationJsonData.run;
              subTrackInfo.geotags = variationJsonData.geotags;
              subTrackInfo.main_track = insertTrackInfo.data[0].id;
              console.log(subTrackInfo);
              database
                .from("race_tracks")
                .select()
                .match({
                  server_id: serverId,
                  friendly_id: variation,
                  main_track: insertTrackInfo.data[0].id,
                })
                .then(async ({ data }) => {
                  console.log("Hopefully we did the check");
                  console.log(data);
                  if (data && data.length == 0) {
                    const insertSubTrack = await database
                      .from("race_tracks")
                      .upsert([subTrackInfo]);
                    if (
                      fs.existsSync(
                        `${serverDir}/content/tracks/${track}/ui/${variation}/outline.png`
                      )
                    ) {
                      if (logs)
                        console.log(`${track} ${variation} has a map outline`);
                      try {
                        const fileContent = fs.readFileSync(
                          `${serverDir}/content/tracks/${track}/ui/${variation}/outline.png`
                        );
                        let fileName = `${Math.random()}.png`;
                        if (subTrackInfo.friendly_id) {
                          fileName = `${trackInfo.friendly_id.toLowerCase()}-${subTrackInfo.friendly_id.toLowerCase()}-outline.png`;
                        }
                        const filePath = `${fileName}`;
                        if (logs) console.log(filePath);
                        let { error: uploadError } = await database.storage
                          .from("map-outlines")
                          .upload(filePath, fileContent);
                        if (uploadError) throw uploadError;
                        if (logs) console.log("uploaded outline");
                      } catch (e) {
                        if (logs) console.log(e);
                      }
                    }
                    if (
                      fs.existsSync(
                        `${serverDir}/content/tracks/${track}/ui/${variation}/preview.png`
                      )
                    ) {
                      if (logs) console.log(`${track} has a map preview`);
                      try {
                        const previewContent = fs.readFileSync(
                          `${serverDir}/content/tracks/${track}/ui/${variation}/preview.png`
                        );
                        let previewFileName = `${Math.random()}.png`;
                        if (subTrackInfo.friendly_id) {
                          previewFileName = `${trackInfo.friendly_id.toLowerCase()}-${subTrackInfo.friendly_id.toLowerCase()}-preview.png`;
                        }
                        const previewPath = `${previewFileName}`;
                        if (logs) console.log(previewPath);
                        let { error: uploadError } = await database.storage
                          .from("map-previews")
                          .upload(previewPath, previewContent);
                        if (uploadError) throw uploadError;
                        if (logs) console.log("uploaded preview");
                      } catch (e) {
                        if (logs) console.log(e);
                      }
                    }
                  }
                });
            }
          }
        }
      }
    });
}

async function carRemove(car, logs = false) {
  database
    .from("race_cars")
    .delete()
    .match({ server_id: serverId, friendly_id: car })
    .then(async ({ data }) => {
      if (logs) console.log(`${car} removed`);
    });
}
async function carUpload(car, logs = false) {
  let carInfo = {};
  if (logs) console.log(`==========CAR UPLOAD==========`);
  if (logs) console.log(`Car: ${car}`);
  if (fs.existsSync(`${serverDir}/content/cars/${car}/ui/ui_car.json`)) {
    if (logs) console.log(`${car} has ui_car.json`);
    // ...
    let jsonData = await fs.readJson(
      `${serverDir}/content/cars/${car}/ui/ui_car.json`
    );
    carInfo.name = jsonData.name;
    carInfo.description = jsonData.description;
    carInfo.brand = jsonData.brand;
    carInfo.tags = jsonData.tags;
    carInfo.specs = jsonData.specs;
    carInfo.country = jsonData.country;
    carInfo.year = jsonData.year;
    carInfo.version = jsonData.version;
    carInfo.class = jsonData.class;
    carInfo.skins = jsonData.skins;
    carInfo.powerCurve = jsonData.powerCurve;
    carInfo.torqueCurve = jsonData.torqueCurve;
    carInfo.author = jsonData.author;
  }
  carInfo.friendly_id = car;
  carInfo.server_id = serverId;

  if (fs.existsSync(`${serverDir}/content/cars/${car}/skins/`)) {
    if (logs) console.log(`${car} has skins`);
    carInfo.skins = await getDirectories(
      `${serverDir}/content/cars/${car}/skins/`
    );
  }

  database
    .from("race_cars")
    .select()
    .match({ server_id: serverId, friendly_id: car })
    .then(async ({ data }) => {
      if (data.length == 0) {
        if (logs) console.log(`${car} Uploading`);
        const insertCarInfo = await database
          .from("race_cars")
          .upsert([carInfo]);
        if (logs) console.log("Insert Error: ", insertCarInfo.error);
        if (fs.existsSync(`${serverDir}/content/cars/${car}/ui/badge.png`)) {
          if (logs) console.log(`${car} has a badge`);
          try {
            const fileContent = fs.readFileSync(
              `${serverDir}/content/cars/${car}/ui/badge.png`
            );
            let fileName = `${Math.random()}.png`;
            if (carInfo.brand) {
              fileName = `${carInfo.brand.toLowerCase()}.png`;
            }
            const filePath = `${fileName}`;
            if (logs) console.log(filePath);
            let { error: uploadError } = await database.storage
              .from("car-badges")
              .upload(filePath, fileContent);
            if (uploadError) throw uploadError;
            if (logs) console.log("uploaded");
          } catch (e) {
            if (logs) console.log(e);
          }
        }
      } else {
        if (logs) console.log(`${car} already exists in database`);
      }
    });
}

function nameifyString(string) {
  return string.replace(/_/g, " ");
}
function titleCase(str) {
  return str.replace(/(^\w|\s\w)/g, (m) => m.toUpperCase());
}

function getDirectories(path) {
  return fs.readdirSync(path).filter(function (file) {
    return fs.statSync(path + "/" + file).isDirectory();
  });
}
const e = require("express");

var app = express();

// view engine setup

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

if (!fs.existsSync(`${serverDir}/content/uploads`)) {
  fs.mkdirSync(`${serverDir}/content/uploads`);
}
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, `${serverDir}/content/uploads`);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});
app.use(multer({ storage: storage }).single("file"));
var uploadRouter = require("./routes/upload");

app.use("/upload", uploadRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("error");
});

module.exports = app;
