from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = 'sqlite:///./contacloud.db'
    SECRET_KEY: str = 'contacloud-secret-key-change-in-production-2024'
    ALGORITHM: str = 'HS256'
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    APP_NAME: str = 'ContaCloud MX'
    MAX_CLIENTS: int = 999

    class Config:
        env_file = ".env"

settings = Settings()
