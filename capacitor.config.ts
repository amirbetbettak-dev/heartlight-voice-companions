import type { CapacitorConfig } from "@capacitor/cli";

// The Android app is a native shell around the published web app: chat, voice and sign-in
// all need the app's server, so the WebView loads the live site instead of a static bundle.
const config: CapacitorConfig = {
  appId: "ir.hamdam.companion",
  appName: "همدم",
  webDir: "capacitor-www",
  server: {
    url: "https://heartlight-voice-companions.lovable.app",
    androidScheme: "https",
    cleartext: false,
  },
  android: {
    backgroundColor: "#0d1017",
  },
};

export default config;
