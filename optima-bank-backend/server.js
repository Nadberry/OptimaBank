const dotenv = require('dotenv');
dotenv.config(); // ✅ Load .env variables FIRST

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const User = require('./models/User');
const multer = require('multer');
const path = require('path');
const passport = require('passport');
require('./passport'); // ✅ AFTER .env loaded

const session = require('express-session');
const app = express(); // ✅ DECLARE THIS FIRST!

const crypto = require('crypto');
const nodemailer = require('nodemailer');

const bcrypt = require('bcrypt');
const saltRounds = 10;



// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

app.use(express.json());

app.use(session({
  secret: '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', // Ideally from process.env
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

// MongoDB
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log('MongoDB connected'))
.catch((err) => console.error('MongoDB error:', err));

// Signup route
app.post('/signup', async (req, res) => {
  const { firstName, lastName, dob, phone, email, password } = req.body;

  try {
    const userExist = await User.findOne({ email });
    if (userExist) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const newUser = new User({ 
      firstName, 
      lastName, 
      dob, 
      phone, 
      email, 
      password: hashedPassword, 
      provider: 'local', 
    });
    await newUser.save();
    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Login route
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid password' });

    res.status(200).json({ message: 'Login successful', user });
  } catch (err) {
    console.error('Login error:', err); // ✅ Log exact error
    res.status(500).json({ message: 'Server error' });
  }
});

// Forgot password route
app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const token = crypto.randomBytes(20).toString('hex');
    user.resetToken = token;
    user.tokenExpiry = Date.now() + 3600000;
    await user.save();

    console.log(`Reset token generated for ${email}: ${token}`);

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });

    const mailOptions = {
      to: user.email,
      from: process.env.MAIL_USER,
      subject: 'Password Reset',
      text: `Click this link to reset your password: http://localhost:3000/reset-password/${token}`,
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: 'Reset email sent!' });

  } catch (err) {
    console.error('Forgot password error:', err); // ✅ LOG IT
    res.status(500).json({ message: 'Error sending email' });
  }
});

app.post('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  try {
    const user = await User.findOne({
      resetToken: token,
      tokenExpiry: { $gt: Date.now() }, // still valid
    });

    if (!user) return res.status(400).json({ message: 'Invalid or expired token' });

    const hashedPassword = await bcrypt.hash(password, saltRounds);
    user.password = hashedPassword;
    user.resetToken = undefined;
    user.tokenExpiry = undefined;
    await user.save();

    res.json({ message: 'Password has been reset!' });
  } catch (err) {
    res.status(500).json({ message: 'Error resetting password' });
  }
});

// Google OAuth
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/login',
    session: true
  }),
  (req, res) => {
    // Option 1: Send user info via redirect query
    const user = req.user;
    const safeUser = {
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImage: user.profileImage || ''
    };
    const query = new URLSearchParams(safeUser).toString();
    res.redirect(`http://localhost:3000/dashboard?${query}`);
  }
);

app.get('/logout', (req, res) => {
  req.logout(err => {
    if (err) return res.status(500).json({ message: 'Logout error' });
    req.session.destroy(() => {
      res.clearCookie('session');
      res.json({ message: 'Logged out' });
    });
  });
});

//profile
// Image Upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });
app.use('/uploads', express.static('uploads'));

app.get('/profile/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const userId = `${user.username}${user.lastName}`;
    res.json({ ...user._doc, userId });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch profile' });
  }
});

app.put('/profile/update/:id', upload.single('profileImage'), async (req, res) => {
  try {
    console.log("REQ FILE:", req.file);   // ✅ Important
    console.log("REQ BODY:", req.body);   // ✅ Check all incoming fields

    const updates = req.body;

    if (req.file) {
      updates.profileImage = `/uploads/${req.file.filename}`;
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true });

    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({ message: 'Profile updated successfully', user });
  } catch (err) {
    console.error('❌ Update error:', err);  // ✅ Log full error
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
