from pydantic import BaseModel


class StreakOut(BaseModel):
    current: int
    best: int
