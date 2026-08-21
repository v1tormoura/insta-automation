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
    link_url: str | None = None
    link_text: str | None = None
    # Posição do link sticker em coordenadas normalizadas do story (0 a 1):
    # x/y são o CENTRO do sticker — x=0 é a borda esquerda, y=0 o topo.
    # Ausentes = padrão do StoryLink (centro da tela).
    link_x: float | None = None
    link_y: float | None = None
    link_width: float | None = None
    link_height: float | None = None
    link_rotation: float | None = None
    # Como a figurinha de link fica visível:
    #   burned (padrão) — pílula já queimada nos pixels pelo Node; aqui só a
    #                     área de toque nativa.
    #   native          — manda `story_link_stickers` para o Instagram desenhar.
    #   both            — os dois (pode duplicar a figurinha).
    link_sticker_mode: str | None = "burned"


class ProfileEditRequest(BaseModel):
    account_id: str
    # Campos ausentes (None) não são alterados — account_edit sobrescreve o que
    # recebe, então enviar apenas o que muda evita apagar o resto do perfil.
    biography: str | None = None
    external_url: str | None = None
    full_name: str | None = None
    # 1=masculino, 2=feminino, 3=personalizado. account_edit FILTRA este campo,
    # então ele exige uma chamada direta ao endpoint (ver rota /profile/edit).
    gender: int | None = None


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


class PublishCommentRequest(BaseModel):
    account_id: str
    # Aceita tanto o pk puro ("2277033926878261772") quanto a forma completa
    # ("2277033926878261772_1903424587"). A forma completa é preferível: sem o
    # "_", media_comment() precisa chamar media_user() e gasta uma requisição
    # extra ao Instagram só para descobrir o dono da mídia.
    media_id: str
    text: str
