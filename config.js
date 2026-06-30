const BLOG_CONFIG = {
  title: "The Seeker",
  description: "A private journal seeking the purpose of human life",
  author: "Hari",
  defaultPasswordPlaceholder: "Enter password to unlock",

  // Supabase Configuration (Optional)
  // To activate comments and visitor logs:
  // 1. Create a free account at https://supabase.com
  // 2. Run the SQL script inside database.sql in the SQL Editor
  // 3. Copy-paste your project URL and API Anon Key below
  // Note: Leave these empty to run in "Standalone Mode" (stores comments in local browser, logs disabled).
  supabaseUrl: "",
  supabaseAnonKey: "",

  // Google Sheets Backend (Free Alternative to Supabase)
  // To use Google Sheets to save comments, likes, and access logs:
  // 1. Paste your deployed Google Apps Script URL here.
  // 2. Clear Supabase configurations above.
  googleSheetsUrl: "https://script.google.com/macros/s/AKfycbyO2w38DtuXZ-x52toFbai9j8wECc7Szy5mDQTub8mSy3ajAQ_QM8TbjLbIslWKOj9i/exec",

  // SHA-256 Hash of Super Admin Password (Default password: "admin")
  // Used to access the visitor logs and delete comments. 
  // You can generate a custom hash inside the Settings Drawer of the blog!
  adminPasswordHash: "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918"
};
