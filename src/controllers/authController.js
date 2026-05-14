// src/modules/auth/auth.controller.js
const User = require("../models/userModel");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sendEmail = require("../services/emailServices");
const { z } = require("zod");
const Subscription = require("../models/subscriptionModel");
require("dotenv").config();

// Validation Schemas
const registerSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
});

const adminCreateUserSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
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
    let user = null;   // For rollback

    try {
        const { name, email, password } = registerSchema.parse(req.body);

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User already exists"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user first
        user = await User.create({
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

        // Check & Link Pending Subscription
        if (req.pendingSubscription) {
            user.currentSubscription = req.pendingSubscription._id;
            await user.save();

            // Update subscription with user ID
            await Subscription.findByIdAndUpdate(req.pendingSubscription._id, {
                user: user._id
            });

            console.log(`Pending subscription linked for ${email}`);
        }

        // Try to send OTP Email
        try {
            await sendEmail(
                user.email,
                "Verify Your IoTify Account",
                `
                <h2>Welcome to IoTify!</h2>
                <p>Hi <strong>${name}</strong>,</p>
                <p>Your verification OTP is: <strong>${otp}</strong></p>
                <p>This OTP will expire in 10 minutes.</p>
                `
            );

            console.log(`OTP Email sent to ${user.email}`);

        } catch (emailError) {
            console.error("Email sending failed:", emailError.message);

            if (user) {
                await User.findByIdAndDelete(user._id);
                console.log(`🗑️ User rolled back: ${user.email}`);
            }

            return res.status(500).json({
                success: false,
                message: "Failed to send verification email. Please try registering again."
            });
        }

        // Success Response
        res.status(201).json({
            success: true,
            message: "Registration successful. Please verify OTP sent to your email.",
            userId: user._id,
            email: user.email
        });

    } catch (error) {
        console.error("Register User Error:", error);

        if (user) {
            await User.findByIdAndDelete(user._id);
            console.log(`🗑️ User rolled back due to error: ${user.email}`);
        }

        if (error.name === "ZodError") {
            return res.status(400).json({
                success: false,
                errors: error.issues.map(err => ({
                    field: err.path[0],
                    message: err.message
                }))
            });
        }

        res.status(500).json({
            success: false,
            message: "Server error during registration"
        });
    }
};

// Admin Creates User (Setup Password Flow)
const createUserByAdmin = async (req, res) => {
    let user = null;   // For rollback

    try {
        const { name, email, role = "manager" } = adminCreateUserSchema.parse(req.body);
        const admin = req.user;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "User already exists" });
        }

        const setupToken = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: "24h" });

        console.log(setupToken)

        // Create user
        user = await User.create({
            name,
            email,
            role,
            creatorId: admin._id,
            createdBy: "admin",
            setupToken,
            isActive: false,
            isVerified: false
        });

        if (req.pendingSubscription) {
            user.currentSubscription = req.pendingSubscription._id;
            await user.save();

            await Subscription.findByIdAndUpdate(req.pendingSubscription._id, {
                user: user._id
            });

            console.log(`Pending subscription linked for admin-created user: ${email}`);
        }

        const setupLink = `${process.env.FRONTEND_URL}/setup-password/${setupToken}`;

        // Send Email
        try {
            await sendEmail(
                user.email,
                "Set Your IoTify Account Password",
                `
                <h2>Account Created Successfully</h2>
                <p>Hello <strong>${name}</strong>,</p>
                <p>Your account has been created by the administrator.</p>
                <p>Please click the link below to set your password:</p>
                <a href="${setupLink}" 
                   style="background:#0055a5; color:white; padding:12px 24px; text-decoration:none; border-radius:6px;">
                   Set Password
                </a>
                <p>This link will expire in 24 hours.</p>
                `
            );
        } catch (emailError) {
            console.error("Email sending failed:", emailError.message);
            await User.findByIdAndDelete(user._id);
            return res.status(500).json({
                success: false,
                message: "Failed to send setup email."
            });
        }

        res.status(201).json({
            success: true,
            message: "User created successfully. Setup link sent to email.",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Create User By Admin Error:", error);

        if (user) {
            await User.findByIdAndDelete(user._id);
            console.log(`User rolled back: ${user.email}`);
        }

        if (error.name === "ZodError") {
            return res.status(400).json({
                success: false,
                errors: error.issues.map((err) => ({
                    field: err.path[0],
                    message: err.message
                }))
            });
        }

        res.status(500).json({
            success: false,
            message: "Failed to create user. " + (error.message.includes("ETIMEDOUT")
                ? "Email service is not responding."
                : "Please try again.")
        });
    }
};

// set password for admin created users 
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
        const { otp } = req.body;

        if (!otp) {
            return res.status(400).json({
                success: false,
                message: "OTP is required"
            });
        }

        const user = await User.findOne({ otp: otp });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: "Invalid OTP"
            });
        }

        if (user.otpExpiry < Date.now()) {
            return res.status(400).json({
                success: false,
                message: "OTP has expired"
            });
        }

        // Verify and Activate User
        user.isVerified = true;
        user.isActive = true
        user.otp = null;
        user.otpExpiry = null;

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
        if (!user.isActive) return res.status(403).json({ message: "Account is not active" });

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

// logout user 
const logoutUser = async (req, res) => {
    try {
        res.clearCookie("token", { httpOnly: true, sameSite: "none", path: "/", secure: true });
        res.status(200).json({ success: true, message: "Logged out successfully" });
    } catch (error) {
        console.error("Error in logout:", error);
        res.status(500).json({ success: false, message: "Logout failed" });
    }
};

module.exports = {
    registerUser,
    createUserByAdmin,
    setPassword,
    registerAdmin,
    verifyOTP,
    loginUser,
    logoutUser
};