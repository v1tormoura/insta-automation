import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..models import ProfileEditRequest, ProfilePictureRequest
from .. import session_pool

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/profile")


def _require_session(account_id: str) -> None:
    if not session_pool.is_loaded(account_id):
        raise HTTPException(
            status_code=400,
            detail={"code": "SESSION_NOT_LOADED", "message": "Chame /session/load antes de editar o perfil"},
        )


@router.post("/edit")
async def profile_edit(body: ProfileEditRequest):
    """
    Edita nome, bio e link da bio usando a sessão instagrapi.

    account_edit(**data) aceita biography, external_url, full_name (entre outros)
    e SOBRESCREVE o que recebe — por isso enviamos apenas os campos presentes na
    requisição, para não apagar o resto do perfil.

    O `external_url` é o link da bio: é suportado pela biblioteca, ao contrário do
    que o caminho antigo (baseado em senha) fazia supor.

    O Instagram exige e-mail ou telefone confirmado na conta para aceitar a
    edição — sem isso ele recusa, e o erro é propagado como está.

    Devolve { ok, profile: {...}, settings }.
    """
    _require_session(body.account_id)

    campos = {
        chave: valor
        for chave, valor in (
            ("biography",    body.biography),
            ("external_url", body.external_url),
            ("full_name",    body.full_name),
        )
        if valor is not None
    }
    if not campos:
        raise HTTPException(
            status_code=400,
            detail={"code": "NOTHING_TO_EDIT", "message": "Envie ao menos um campo para alterar"},
        )

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        loop   = asyncio.get_running_loop()
        try:
            conta = await loop.run_in_executor(None, lambda: client.account_edit(**campos))
        except Exception as e:
            logger.exception("profile_edit: failed for account %s", body.account_id)
            code = session_pool.classify_error(e)
            raise HTTPException(status_code=422, detail={"code": code, "message": str(e)[:300]})
        settings = client.get_settings()

    session_pool._slog("PROFILE_EDITED", body.account_id, campos=",".join(sorted(campos)))
    return {
        "ok": True,
        "profile": {
            "username":     getattr(conta, "username", "") or "",
            "full_name":    getattr(conta, "full_name", "") or "",
            "biography":    getattr(conta, "biography", "") or "",
            "external_url": str(getattr(conta, "external_url", "") or ""),
        },
        "settings": settings,
    }


@router.post("/picture")
async def profile_picture(body: ProfilePictureRequest):
    """
    Troca a foto de perfil via account_change_picture.

    Requer sessão carregada. Devolve { ok, pk, settings }.
    """
    _require_session(body.account_id)

    caminho = Path(body.image_path)
    if not caminho.exists():
        raise HTTPException(
            status_code=422,
            detail={"code": "FILE_NOT_FOUND", "message": f"Imagem não encontrada: {body.image_path}"},
        )

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        loop   = asyncio.get_running_loop()
        try:
            usuario = await loop.run_in_executor(
                None, lambda: client.account_change_picture(path=caminho)
            )
        except Exception as e:
            logger.exception("profile_picture: failed for account %s", body.account_id)
            code = session_pool.classify_error(e)
            raise HTTPException(status_code=422, detail={"code": code, "message": str(e)[:300]})
        settings = client.get_settings()

    session_pool._slog("PROFILE_PICTURE_CHANGED", body.account_id)
    return {"ok": True, "pk": str(getattr(usuario, "pk", "") or ""), "settings": settings}
