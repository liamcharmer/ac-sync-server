require("dotenv").config();

var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
const fs = require("fs-extra");

const supabase = require("@supabase/supabase-js");

const database = supabase.createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

let serverId = null;

database
  .from("race_server")
  .select()
  .eq("server_token", process.env.SERVER_TOKEN)
  .then(async ({ data }) => {
    let extIP = require("ext-ip")();
    let externalIp = await extIP.get();
    const serverData = {
      server_name: process.env.SERVER_NAME,
      server_description: process.env.SERVER_DESCRIPTION,
      server_port: process.env.SERVER_PORT,
      server_token: process.env.SERVER_TOKEN,
      server_ip: externalIp,
    };
    if (data.length > 0) {
      serverData.id = data[0].id;
    }

    const insertInfo = await database.from("race_server").upsert([serverData]);
    serverId = insertInfo.data[0].id;
    let cars = await getDirectories("../serverfiles/content/cars");
    for (let c = 0; c < cars.length; c++) {
      let car = cars[c];
      carUpload(car);
    }
    let tracks = await getDirectories("../serverfiles/content/tracks");
    for (let c = 0; c < tracks.length; c++) {
      let track = tracks[c];
      trackUpload(track);
    }
  });
async function trackUpload(track) {
  let trackInfo = {};
  trackInfo.friendly_id = track;
  trackInfo.server_id = serverId;
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
async function carUpload(car) {
  let carInfo = {};

  if (fs.existsSync(`../serverfiles/content/cars/${car}/ui/ui_car.json`)) {
    // ...
    carInfo = {
      ...(await fs.readJson(
        `../serverfiles/content/cars/${car}/ui/ui_car.json`
      )),
    };
  }
  carInfo.friendly_id = car;
  carInfo.server_id = serverId;

  if (carInfo.url) delete carInfo.url;

  if (fs.existsSync(`../serverfiles/content/cars/${car}/skins/`)) {
    carInfo.skins = await getDirectories(
      `../serverfiles/content/cars/${car}/skins/`
    );
  }

  database
    .from("race_cars")
    .select()
    .match({ server_id: serverId, friendly_id: car })
    .then(async ({ data }) => {
      if (data.length == 0) {
        const insertCarInfo = await database
          .from("race_cars")
          .upsert([carInfo]);
        if (fs.existsSync(`../serverfiles/content/cars/${car}/ui/badge.png`)) {
          try {
            const fileContent = fs.readFileSync(
              `../serverfiles/content/cars/${car}/ui/badge.png`
            );
            let fileName = `${Math.random()}.png`;
            if (carInfo.brand) {
              fileName = `${carInfo.brand.toLowerCase()}.png`;
            }
            const filePath = `${fileName}`;
            console.log(filePath);
            let { error: uploadError } = await database.storage
              .from("car-badges")
              .upload(filePath, fileContent);
            if (uploadError) throw uploadError;
            console.log("uploaded");
          } catch (e) {
            console.log(e);
          }
        }
      }
    });
}

function getDirectories(path) {
  return fs.readdirSync(path).filter(function (file) {
    return fs.statSync(path + "/" + file).isDirectory();
  });
}
var usersRouter = require("./routes/users");
const e = require("express");

var app = express();

// view engine setup

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/", usersRouter);

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
