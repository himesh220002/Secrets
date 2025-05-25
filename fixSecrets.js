// fixSecrets.js
require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const userSchema = new mongoose.Schema({
  email: String,
  password: String,
  googleId: String,
  secret: {
    type: [String],
    default: [],
  }
});

const User = mongoose.model("User", userSchema);

async function fixSecretsField() {
  try {
    const result = await User.updateMany(
      { secret: { $not: { $type: 'array' } } },
      [{
        $set: {
          secret: {
            $cond: [
              { $isArray: "$secret" },
              "$secret",
              ["$secret"]
            ]
          }
        }
      }]
    );

    console.log("✅ Updated users:", result.modifiedCount);
  } catch (err) {
    console.error("❌ Error updating users:", err);
  } finally {
    mongoose.connection.close();
  }
}

fixSecretsField();

