from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://scheduler:scheduler_secret@localhost:5432/school_scheduler"
    SOLVER_TIME_LIMIT_SECONDS: int = 120

    # School calendar constants
    DAYS_PER_WEEK: int = 5          # Mon–Fri
    PERIODS_PER_DAY: int = 10       # 0-based index; some are fixed events

    # Periods that are NOT schedulable (school-wide fixed events)
    # 0 = Assembly (Mon) / Homeroom (Tue–Fri)
    # 4 = Break (10 min)
    # 7 = Lunch M1-3   8 = Lunch M4-6   9 = Homeroom/wrap-up
    BREAK_PERIOD: int = 4
    ASSEMBLY_PERIOD: int = 0

    # Lunch staggering: M1-M3 groups → period 7, M4-M6 groups → period 8
    LUNCH_LOWER: int = 7
    LUNCH_UPPER: int = 8
    LOWER_LEVELS: list[str] = ["M1", "M2", "M3"]
    UPPER_LEVELS: list[str] = ["M4", "M5", "M6"]

    # Outdoor cap per slot
    MAX_OUTDOOR_SIMULTANEOUS: int = 2

    class Config:
        env_file = ".env"


settings = Settings()
