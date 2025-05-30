//jshint esversion:6
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const ejs = require("ejs");
// const bodyParser = require("body-parser");
const session = require("express-session");
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const findOrCreate = require("mongoose-findorcreate");
const crypto = require("crypto");
const path = require("path");
const MongoStore = require("connect-mongo");


const app = express();




// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// app.use(express.static(path.join(__dirname, "public")));
app.use(express.static("public"));

// Middleware for static files and view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// app.get("/favicon.ico", (req, res) => res.status(204));


// app.use((req, res, next) => {
//   res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net;");
//   next();
// });


mongoose.set('strictQuery', true);

app.set('trust proxy', 1); 
// Session config
app.use(
  session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions",
    }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24, // 1 day
      sameSite: "lax", // important for cookies in Vercel
      secure: process.env.NODE_ENV === "production", // only true in prod
    },
  })
  
);

// Passport config
app.use(passport.initialize());
app.use(passport.session());

// Connect MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ Connected to MongoDB Atlas!"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// SCHEMA & MODEL
const userSchema = new mongoose.Schema({
  username: String,
  // password: String,
  googleId: String,
  secret: {
    type: [
    {
      text: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
      _id: { type: mongoose.Schema.Types.ObjectId, auto: true } // auto-generate unique ID
    }
  ],
    default: [],
  },
});



userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);

const User = mongoose.model("User", userSchema);

// Passport Local
passport.use(User.createStrategy());

passport.serializeUser(function (user, done) {
  done(null, user.id);
});
passport.deserializeUser(function (id, done) {
  User.findById(id, function (err, user) {
    done(err, user);
  });
});

if (require.main === module) {
  passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/secrets" ,
    },
    function (accessToken, refreshToken, profile, cb) {
      User.findOrCreate({ googleId: profile.id }, function (err, user) {
        return cb(err, user);
      });
    }
  )
);
}else{

// Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google/secrets" ,
    },
    function (accessToken, refreshToken, profile, cb) {
      User.findOrCreate({ googleId: profile.id }, function (err, user) {
        return cb(err, user);
      });
    }
  )
);
}
// hashing helper
function hashValue(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}


function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

// ROUTES
app.get("/", (req, res) => {
  res.render("home");
});

app.get("/auth/google", passport.authenticate("google", { scope: ["profile"] }));

app.get(
  "/auth/google/secrets",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (req, res) => {
    res.redirect("/secrets");
  }
);

app.get("/login", (req, res) => res.render("login"));
app.get("/register", (req, res) => res.render("register"));

// app.get("/secrets", (req, res) => {
//   User.find({ secret: { $exists: true, $not: { $size: 0 } } }, (err, foundUsers) => {
//     if (err) return console.log(err);
//     res.render("secrets", { usersWithSecrets: foundUsers });
//   });
// });

const Like = require("./models/Like");

app.get("/secrets", isAuthenticated, async (req, res) => {
  const users = await User.find({ secret: { $exists: true, $not: { $size: 0 } } }).lean();
  const likes = await Like.find().lean();

  // Flatten all secrets from all users into one array
  const allSecrets = [];

  users.forEach((user) => {
    const secretsArray = Array.isArray(user.secret) ? user.secret : [user.secret];
    secretsArray.forEach((secret) => {
      if (secret && secret.text) {
        allSecrets.push({
          _id: secret._id,
          text: secret.text,
          createdAt: secret.createdAt || new Date(0),
          userId: user._id
        });
      }
    });
  });

  // ✅ Sort all secrets by createdAt (latest first)
  allSecrets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // ✅ Map likes and dislikes
  const likeMap = {};
  likes.forEach((like) => {
    if (!likeMap[like.secretId]) {
      likeMap[like.secretId] = { likes: [], dislikes: [] };
    }
    likeMap[like.secretId][like.type + "s"].push(like.userId.toString());
  });

  res.render("secrets", {
    allSecrets,
    likeMap,
    currentUserId: req.user._id.toString(),
    currentPage: "/secrets"
  });
});


app.get("/submit", (req, res) => {
  if (req.isAuthenticated()) {
    res.render("submit");
  } else {
    res.redirect("/login");
  }
});

app.post("/submit", async (req, res) => {
  const submittedSecret = req.body.secret;

  if (!submittedSecret || submittedSecret.trim() === "") {
    return res.redirect("/submit"); // Optional fallback, but handled in frontend
  }

   try {
    await User.findByIdAndUpdate(
      req.user.id,
      {
        $push: {
          secret: {
            text: submittedSecret,
            createdAt: new Date()
          }
        }
      }
    );
    res.redirect("/secrets");
  } catch (err) {
    console.error(err);
    res.redirect("/submit");
  }
});


app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) console.error(err);
    res.redirect("/");
  });
});

app.get("/mypost", isAuthenticated, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  const likes = await Like.find().lean();

  const likeMap = {};
  likes.forEach(like => {
    if (!likeMap[like.secretId]) {
      likeMap[like.secretId] = { likes: [], dislikes: [] };
    }
    likeMap[like.secretId][like.type + "s"].push(like.userId.toString());
  });

  const mySecrets = (user.secret || []).map((item) => ({
    _id: item._id,
    text: item.text,
    createdAt: item.createdAt
  }));

  res.render("mypost", {
    mySecrets,
    likeMap,
    currentUserId: req.user._id.toString(),
    currentPage: "/mypost"
  });
});


// DELETE secret
app.post("/delete/:id", isAuthenticated, async (req, res) => {
  const secretId = req.params.id;

  await User.findByIdAndUpdate(req.user.id, {
    $pull: { secret: { _id: secretId } }
  });

  res.redirect("/mypost");
});

// EDIT page
app.get("/edit/:id", isAuthenticated, async (req, res) => {
  const user = await User.findById(req.user.id);
  const secret = user.secret.find((s) => s._id.toString() === req.params.id);
  res.render("edit", { secret });
});

// UPDATE secret
app.post("/edit/:id", isAuthenticated, async (req, res) => {
  const updatedText = req.body.secret;
  const secretId = req.params.id;

  await User.updateOne(
    { _id: req.user.id, "secret._id": secretId },
    {
      $set: {
        "secret.$.text": updatedText
      }
    }
  );

  res.redirect("/mypost");
});





// Like a secret
app.post("/secret/:id/like", isAuthenticated, async (req, res) => {

  console.log("🔁 Like route hit for:", req.params.id);
  const redirectTo = req.body.redirectTo || "/secrets";
  
  const existing = await Like.findOne({ userId: req.user._id, secretId: req.params.id });

  if (existing) {
    if (existing.type === "like") await existing.deleteOne();
    else {
      existing.type = "like";
      await existing.save();
    }
  } else {
    await Like.create({ 
      userId: req.user._id, 
      secretId: req.params.id, 
      type: "like" });
  }

  res.redirect(redirectTo);
});

// Dislike a secret
app.post("/secret/:id/dislike", isAuthenticated, async (req, res) => {

  const redirectTo = req.body.redirectTo || "/secrets";

  const existing = await Like.findOne({ userId: req.user._id, secretId: req.params.id });

  if (existing) {
    if (existing.type === "dislike") await existing.deleteOne();
    else {
      existing.type = "dislike";
      await existing.save();
    }
  } else {
    await Like.create({ userId: req.user._id, secretId: req.params.id, type: "dislike" });
  }

  res.redirect(redirectTo);
});

app.post("/test", (req, res) => {
  res.send("Test POST working");
});



app.post("/register", (req, res) => {
  
  User.register(
    { username: req.body.username }, 
    req.body.password, (err, user) => {
    if (err) {
      console.log(err);
      return res.redirect("/register");
    }
    passport.authenticate("local")(req, res, () => res.redirect("/secrets"));
  });
});

app.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) {
      console.error("❌ Auth error:", err);
      return res.status(500).send("Internal server error.");
    }
    if (!user) {
      return res.redirect("/login");
    }

    req.login(user, (err) => {
      if (err) {
        console.error("❌ Login error:", err);
        return res.status(500).send("Login failed.");
      }
      return res.redirect("/secrets");
    });
  })(req, res, next);
});


// SERVER
// Only run server locally (not in serverless/Vercel mode)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 Server started on port ${PORT}`));
}

module.exports = app; 
