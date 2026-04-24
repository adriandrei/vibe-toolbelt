# Vibe Toolbelt

A powerful, privacy-first developer toolkit designed for speed, security, and aesthetics. All processing happens locally in your browser—no data is sent to external servers.

![Vibe Toolbelt](https://img.shields.io/badge/Privacy-First-10b981?style=flat-square)
![Local Processing](https://img.shields.io/badge/Processing-Client--Side-3b82f6?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-gray?style=flat-square)

## 🌟 Key Features

-   **100% Client-Side**: Your data never leaves your machine. Perfect for handling sensitive keys, tokens, and proprietary code.
-   **Local AI Assistant**: Integrated WebLLM engine for privacy-preserving, on-device AI assistance.
-   **Inter-Tool Pipeline**: Seamlessly send data between tools (e.g., export a screen recording directly to the Video Studio, or parse a JWT and send its payload to the JSON Formatter).
-   **Command Palette**: Quick navigation and execution via `Ctrl+K` / `Cmd+K`.
-   **Smart Paste**: Automatically detects clipboard content and routes it to the correct tool (e.g., pasting a JWT opens the JWT tool).
-   **Dark & Light Modes**: Beautiful, glassmorphism-inspired UI tailored for modern workflows.

---

## 🛠️ Tools Available

### Cryptography & Security
- **JWT Decoder**: Decode and inspect JSON Web Tokens safely.
- **Generators**: Hash (MD5, SHA-1, SHA-256, etc.), HMAC, RSA Keys, Passwords, UUIDs (v1, v4), NanoIDs.
- **Encryption/Decryption**: AES encryption and Bcrypt hashing.
- **OTP Generator**: Generate one-time passwords for 2FA.

### Text & Data
- **Inspector**: Analyze strings, detect formats (JWT, UUID, Hex, Base64), and calculate entropy.
- **Formatters & Converters**: JSON, SQL, XML formatting, and CSV ↔ JSON conversion.
- **Regex Tester**: Write and test regular expressions with real-time highlighting.
- **Diff Checker**: Compare text or code side-by-side.
- **Transformers**: Case Converter, Markdown Editor, List Sorter, Text Stats.

### Encoders & Decoders
- **Base64**: Text and Image Base64 encoding/decoding.
- **URL & HTML**: URL Encode/Decode, HTML Entity encoder.
- **Number Base**: Convert between Binary, Octal, Decimal, and Hex.

### Web & Networking
- **API Tester**: Full-featured REST client with collections, history, environments, and cURL import/export.
- **Network Utils**: CIDR Calculator, User-Agent Parser, URL Parser, HTTP Status code reference.
- **System**: Unix Timestamp converter, Linux Chmod calculator.

### Generators & Mock Data
- **Faker**: Generate complex, nested JSON/CSV/SQL schemas with realistic mock data.
- **Generators**: QR Code generator, Lorem Ipsum generator, Random Username generator.
- **Meta Tags**: SEO and social media meta tag builder.

### CSS & Design
- **CSS Generators**: Glassmorphism, Gradients, CSS Triangles, Box Shadows.
- **Color Tools**: Color Converter (HEX/RGB/HSL), Color Blindness simulator.

### Media & Files
- **Video & Audio**: Screen Recorder (with PiP, System Audio, GIF export) and Video Studio (Crop, Trim, Downscale).
- **Images**: Image Converter, SVG Compressor, Favicon Generator, EXIF Metadata Viewer.
- **Files**: PDF Tools (Merge/Split), Hex Viewer for binary files.

### Utilities
- **Keycode Viewer**: Inspect JavaScript keycodes.
- **Cron Parser**: Translate cron expressions into human-readable text.
- **Snippets**: Local code snippet manager.
- **Privacy Scanner**: Scan text for PII and sensitive data.

---

## 🚀 Running Locally

```bash
git clone https://github.com/adriandrei/vibe-toolbelt.git
cd vibe-toolbelt
npm install
npm run dev
```

The application will be available at `http://localhost:5173`.

## 🤝 Contributing

We welcome contributions! Please follow these steps:
1.  Fork the repository.
2.  Create a feature branch (`git checkout -b feature/amazing-tool`).
3.  Commit your changes (`git commit -m 'Add amazing tool'`).
4.  Push to the branch (`git push origin feature/amazing-tool`).
5.  Submit a Pull Request.

**Important Note:** Ensure all new features, tools, and libraries work **100% offline** and client-side. No server-side processing is permitted to maintain the privacy-first guarantee.

## 📄 License

This project is licensed under the MIT License.
