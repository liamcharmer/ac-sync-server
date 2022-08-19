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
      if (!folderName.includes(".")) {
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
    .delete()
    .match({ server_id: serverId, friendly_id: track })
    .then(async ({ data }) => {
      if (logs) console.log(`${car} removed`);
    });
}
async function trackUpload(track) {
  let trackInfo = {};
  trackInfo.friendly_id = track;
  trackInfo.server_id = serverId;
  let trackVersions = await getDirectories(
    `${serverDir}/content/tracks/${track}/`
  );
  if (trackVersions.length > 1) {
    trackInfo.versions = trackVersions;
  }

  database
    .from("race_tracks")
    .select()
    .match({ server_id: serverId, friendly_id: track })
    .then(async ({ data }) => {
      if (data.length == 0) {
        const insertTrackInfo = await database
          .from("race_tracks")
          .upsert([trackInfo]);
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
