import os

# MySQL on XAMPP: default user "root" with an empty password. Change if yours differs.
DATABASE_URL = os.getenv(
    "DATABASE_URL", "mysql+pymysql://root:@127.0.0.1:3306/aegis_bank?charset=utf8mb4"
)
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production-aegis-demo-secret-key-32b")
ACCESS_MINUTES = 30
REFRESH_DAYS = 7
DEMO_MODE = True            # when True the OTP is returned to the UI so it can be shown in a modal
OTP_TTL_SECONDS = 300
FACE_MATCH_THRESHOLD = 0.50  # euclidean distance between face embeddings (lower = stricter)
MAX_TRANSFER_KOBO = 10_000_000 * 100
# comma-separated list; in production set this to your Render frontend URL (no trailing slash)
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
DB_SSL = os.getenv("DB_SSL", "").lower() in ("1", "true", "yes")   # Aiven requires TLS
