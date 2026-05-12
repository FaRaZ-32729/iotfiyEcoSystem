// src/modules/auth/auth.controller.js
const User = require("../models/userModel");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sendEmail = require("../services/emailServices");
const { z } = require("zod");

// Validation Schemas
const registerSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
});

const adminCreateUserSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    role: z.enum(["manager", "user"]).default("user")
});


const registerAdmin = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Strong validation
        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: "Name, email and password are required" });
        }

        if (password.length < 8) {
            return res.status(400).json({ success: false, message: "Password must be at least 8 characters long" });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "User with this email already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const admin = await User.create({
            name,
            email,
            password: hashedPassword,
            role: "admin",
            createdBy: "self",
            isActive: true,
            isVerified: true   // Admin is auto-verified
        });

        // Send welcome email to admin
        await sendEmail(
            admin.email,
            "🎉 Welcome Admin - IoTify Dashboard",
            `
            <h2>Congratulations! You are now the Admin of IoTify.</h2>
            <p><strong>Name:</strong> ${admin.name}</p>
            <p><strong>Email:</strong> ${admin.email}</p>
            <p>You have full access to the system.</p>
            `
        );

        res.status(201).json({
            success: true,
            message: "Admin registered successfully",
            admin: {
                id: admin._id,
                name: admin.name,
                email: admin.email,
                role: admin.role
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Server error while registering admin" });
    }
};

// Register Self (Normal User → becomes Manager)
const registerUser = async (req, res) => {
    try {
        const { name, email, password } = registerSchema.parse(req.body);

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "User already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await User.create({
            name,
            email,
            password: hashedPassword,
            role: "manager",
            createdBy: "self",
            isActive: false,
            isVerified: false
        });

        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.otp = otp;
        user.otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes
        await user.save();

        // Send OTP Email
        await sendEmail(
            user.email,
            "Verify Your IoTify Account",
            `
            <h2>Welcome to IoTify!</h2>
            <p>Your OTP is: <strong>${otp}</strong></p>
            <p>This OTP will expire in 10 minutes.</p>
            `
        );

        res.status(201).json({
            success: true,
            message: "Registration successful. Please verify OTP sent to your email.",
            userId: user._id
        });

    } catch (error) {
        if (error.name === "ZodError") {
            return res.status(400).json({ message: error.errors });
        }
        res.status(500).json({ message: "Server error" });
    }
};

// Admin Creates User (Setup Password Flow)
const createUserByAdmin = async (req, res) => {
    try {
        const { name, email, role } = adminCreateUserSchema.parse(req.body);
        const admin = req.user;

        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: "User already exists" });

        const setupToken = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: "1d" });

        const user = await User.create({
            name,
            email,
            role,
            creatorId: admin._id,
            createdBy: "admin",
            setupToken,
            isActive: false,
            isVerified: false
        });

        const setupLink = `${process.env.FRONTEND_URL}/setup-password/${setupToken}`;

        await sendEmail(
            user.email,
            "Set Your IoTify Account Password",
            `
            <h2>Account Created</h2>
            <p>Hello ${name},</p>
            <p>Your account has been created by Admin.</p>
            <a href="${setupLink}" style="padding:12px 20px; background:#0055a5; color:white; text-decoration:none;">Set Password</a>
            `
        );

        res.status(201).json({
            success: true,
            message: "User created. Setup link sent to email.",
            user
        });

    } catch (error) {
        if (error.name === "ZodError") return res.status(400).json({ message: error.errors });
        res.status(500).json({ message: "Server error" });
    }
};

// Set Password (for admin-created users)
const setPassword = async (req, res) => {
    try {
        const { token } = req.params;
        const { password } = req.body;

        if (!token || !password) {
            return res.status(400).json({
                success: false,
                message: "Token and password are required"
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters long"
            });
        }

        // Verify the setup token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(400).json({
                success: false,
                message: "Invalid or expired setup link"
            });
        }

        // Find user with this setup token
        const user = await User.findOne({
            email: decoded.email,
            setupToken: token
        });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: "Invalid or expired setup link"
            });
        }

        // Hash and save password
        const hashedPassword = await bcrypt.hash(password, 10);

        user.password = hashedPassword;
        user.setupToken = null;           // Clear setup token after use

        // Generate OTP for next step (verification)
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.otp = otp;
        user.otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

        await user.save();

        // Send OTP Email
        await sendEmail(
            user.email,
            "Verify Your IoTify Account",
            `
            <h2>Password Set Successfully!</h2>
            <p>Your account password has been set.</p>
            <p>Your verification OTP is: <strong>${otp}</strong></p>
            <p>This OTP will expire in 10 minutes.</p>
            `
        );

        res.status(200).json({
            success: true,
            message: "Password set successfully. Please verify OTP sent to your email.",
            email: user.email
        });

    } catch (error) {
        console.error("Set Password Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// Verify OTP
const verifyOTP = async (req, res) => {
    try {
        const { otp } = req.body;           // OTP comes in body
        const { token } = req.params;       // Optional: only for admin-created users

        if (!otp) {
            return res.status(400).json({
                success: false,
                message: "OTP is required"
            });
        }

        let user;

        // Case 1: Admin-created user (has setupToken in URL)
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                user = await User.findOne({
                    email: decoded.email,
                    setupToken: token
                });
            } catch (err) {
                return res.status(400).json({ success: false, message: "Invalid or expired setup link" });
            }
        }
        // Case 2: Normal self-registered user (most common)
        else {
            user = await User.findOne({ otp: otp });
        }

        if (!user) {
            return res.status(400).json({ success: false, message: "User not found" });
        }

        // Check OTP validity
        if (user.otp !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        if (user.otpExpiry < Date.now()) {
            return res.status(400).json({ success: false, message: "OTP has expired" });
        }

        // Success - Verify user
        user.isVerified = true;
        user.otp = null;
        user.otpExpiry = null;

        // Clear setupToken if it was used
        if (token) {
            user.setupToken = null;
        }

        await user.save();

        res.status(200).json({
            success: true,
            message: "Account verified successfully. You can now login.",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Verify OTP Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// Login
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });

        if (!user.isVerified) return res.status(403).json({ message: "Please verify your email first" });
        // if (!user.isActive) return res.status(403).json({ message: "Account is not active" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

        const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

        user.lastLogin = new Date();
        await user.save();

        res.cookie('token', token, {
            httpOnly: true,           // Prevents JavaScript access (Security)
            secure: process.env.NODE_ENV === 'production', // Use secure in production
            sameSite: 'strict',       // Protects against CSRF
            maxAge: 7 * 24 * 60 * 60 * 1000   // 7 days in milliseconds
        });

        res.json({
            success: true,
            message: "Login successful",
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                isActive: user.isActive
            }
        });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

module.exports = {
    registerUser,
    createUserByAdmin,
    setPassword,
    registerAdmin,
    verifyOTP,
    loginUser
};