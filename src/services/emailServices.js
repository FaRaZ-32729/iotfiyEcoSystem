const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

// Create transporter using your SMTP credentials
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, 
    port: process.env.SMTP_PORT || 465, 
    secure: true,
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

            // Attach inline image similar to Nodemailer "cid"
            attachments: [
                {
                    filename: "logo.png",
                    path: path.join(__dirname, "../assets/logo.png"),
                    cid: "logo"
                }
            ]
        });

        console.log("Email sent ✔");
    } catch (err) {
        console.error("SMTP error:", err);
    }
};

module.exports = sendEmail;
