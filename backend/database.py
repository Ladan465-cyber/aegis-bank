from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from config import DATABASE_URL, DB_SSL

# Aiven MySQL only accepts TLS connections. An ssl dict enables encryption in PyMySQL.
connect_args = {"ssl": {"check_hostname": False}} if DB_SSL else {}
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=1800, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
