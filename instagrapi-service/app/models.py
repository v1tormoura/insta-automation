from typing import Optional, Any, Dict
from pydantic import BaseModel


class LoadRequest(BaseModel):
    account_id: str
    settings: Dict[str, Any]
    proxy: Optional[str] = None


class EvictRequest(BaseModel):
    account_id: str


class LoginRequest(BaseModel):
    account_id: str
    username: str
    password: str
    verification_code: Optional[str] = ""
    proxy: Optional[str] = None


class TwoFactorVerifyRequest(BaseModel):
    account_id: str
    verification_code: str


class PublishReelRequest(BaseModel):
    account_id: str
    media_path: str
    caption: str = ""
    cover_path: Optional[str] = None


class PublishPostRequest(BaseModel):
    account_id: str
    media_path: str
    caption: str = ""
