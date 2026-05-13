const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Create transporter using your SMTP credentials
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

const sendEmail = async (to, subject, html) => {
    try {

        await transporter.sendMail({
            from: `LuckyOneMall <${process.env.SMTP_USER}>`,
            to,
            subject,
            html,
        });

        console.log("Email sent ✔");
    } catch (err) {
        console.error("SMTP error:", err);
        throw err;
    }
};

module.exports = sendEmail;


// utils/sendEmail.js
// const nodemailer = require("nodemailer");
// require("dotenv").config();

// const transporter = nodemailer.createTransport({
//     host: process.env.SMTP_HOST,        // smtp.gmail.com
//     port: 465,                          // ← Changed to 465
//     secure: true,                       // ← Important for port 465
//     auth: {
//         user: process.env.SMTP_USER,
//         pass: process.env.SMTP_PASS
//     },
//     // Professional Settings
//     family: 4,                          // Force IPv4
//     connectionTimeout: 20000,
//     greetingTimeout: 20000,
//     socketTimeout: 25000,

//     tls: {
//         rejectUnauthorized: false
//     }
// });

// // Optional: Test connection on startup
// transporter.verify((error, success) => {
//     if (error) {
//         console.error("❌ SMTP Connection Failed:", error.message);
//     } else {
//         console.log("✅ SMTP Server is ready to send emails");
//     }
// });

// const sendEmail = async (to, subject, html) => {
//     try {
//         const info = await transporter.sendMail({
//             from: `"IoTify" <${process.env.SMTP_USER}>`,
//             to,
//             subject,
//             html,
//         });

//         console.log(`✅ Email sent to ${to} | ID: ${info.messageId}`);
//         return info;

//     } catch (err) {
//         console.error("❌ SMTP Error:", err.message);
//         throw err;   // Important: Re-throw for rollback
//     }
// };

// module.exports = sendEmail;