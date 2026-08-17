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


class SessionIdLoginRequest(BaseModel):
    account_id: str
    sessionid: str
    proxy: str | None = None


class ChallengeCodeRequest(BaseModel):
    account_id: str
    code: str


class PublishStoryRequest(BaseModel):
    account_id: str
    media_path: str
    caption: str = ""
    # Link sticker do story. O Instagram exige elegibilidade da conta (em geral
    # 10 mil seguidores ou verificação) — sem isso ele recusa o sticker.
    link_url: str | None = None


class ProfileEditRequest(BaseModel):
    account_id: str
    # Campos ausentes (None) não são alterados — account_edit sobrescreve o que
    # recebe, então enviar apenas o que muda evita apagar o resto do perfil.
    biography: str | None = None
    external_url: str | None = None
    full_name: str | None = None


class ProfilePictureRequest(BaseModel):
    account_id: str
    image_path: str


class PublishReelRequest(BaseModel):
    account_id: str
    media_path: str
    caption: str = ""
    cover_path: Optional[str] = None


class PublishPostRequest(BaseModel):
    account_id: str
    media_path: str
    caption: str = ""
