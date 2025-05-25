const express = require("express");
const serverless = require("@vendia/serverless-express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const mongoose = require("mongoose");
const ejs = require("ejs");
const dotenv = require("dotenv");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const findOrCreate = require("mongoose-findorcreate");

dotenv.config();

const app = express();

// Static files and views
app.use(express.static(path.join(__dirname, "../public")));
app.set("views", path.join(__dirname, "../views"));
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));

// Session and Passport
app.use(session({
  secret: process.env.SECRET || "keyboardcat",
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// DB Connect
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("Connected to MongoDB Atlas"))
  .catch((err) => console.error("MongoDB Connection Error:", err));

// Schema and Model
const userSchema = new mongoose.Schema({
  email: String,
  password: String,
  googleId: String,
  secret: [String]
});
userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);
const User = mongoose.model("User", userSchema);

passport.use(User.createStrategy());
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => User.findById(id, done));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/api/auth/google/callback",
}, (accessToken, refreshToken, profile, cb) => {
  User.findOrCreate({ googleId: profile.id }, cb);
}));

// Routes (same as in your old app.js)
app.get("/", (req, res) => res.render("home"));
app.get("/auth/google", passport.authenticate("google", { scope: ["profile"] }));
app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/api/login" }),
  (req, res) => res.redirect("/api/secrets")
);
app.get("/login", (req, res) => res.render("login"));
app.get("/register", (req, res) => res.render("register"));
app.get("/secrets", (req, res) => {
  User.find({ secret: { $exists: true, $not: { $size: 0 } } }, (err, foundUsers) => {
    if (err) return console.log(err);
    res.render("secrets", { usersWithSecrets: foundUsers });
  });
});
app.get("/submit", (req, res) => {
  if (req.isAuthenticated()) return res.render("submit");
  res.redirect("/api/login");
});
app.post("/submit", async (req, res) => {
  const submittedSecret = req.body.secret;
  if (!submittedSecret) return res.send("<script>alert('Enter secret'); window.history.back();</script>");

  try {
    await User.findByIdAndUpdate(req.user.id, { $push: { secret: submittedSecret } }, { new: true });
    res.redirect("/api/secrets");
  } catch (err) {
    console.error(err);
    res.redirect("/api/submit");
  }
});
app.get("/logout", (req, res) => {
  req.logout(err => {
    if (err) console.log(err);
    res.redirect("/api");
  });
});
app.post("/register", (req, res) => {
  User.register({ username: req.body.username }, req.body.password, (err, user) => {
    if (err) return res.redirect("/api/register");
    passport.authenticate("local")(req, res, () => res.redirect("/api/secrets"));
  });
});
app.post("/login", (req, res) => {
  const user = new User({ username: req.body.username, password: req.body.password });
  req.login(user, err => {
    if (err) return console.log(err);
    passport.authenticate("local")(req, res, () => res.redirect("/api/secrets"));
  });
});

// Export for serverless
module.exports = serverless({ app });
