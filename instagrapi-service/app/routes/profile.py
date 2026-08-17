import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..models import ProfileEditRequest, ProfilePictureRequest
from .. import session_pool

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/profile")


def _edit_com_genero(client, campos: dict, genero: int) -> None:
    """
    Envia accounts/edit_profile/ incluindo `gender`.

    account_edit() filtra os dados para (external_url, username, full_name,
    biography, phone_number, email) — `gender` é descartado silenciosamente. O
    endpoint em si aceita o campo, então aqui a chamada é direta.

    O endpoint SOBRESCREVE o perfil: os campos não informados são preenchidos com
    os valores atuais, senão a edição apagaria bio, nome ou link. e-mail e telefone
    só são enviados quando existem — enviar vazio dispara o erro "You need an
    email or confirmed phone number".

    Esta é a única parte que sai da superfície pública da biblioteca, porque a
    biblioteca não expõe gênero.
    """
    atual = client.account_info()

    payload = {
        "username":     campos.get("username")     or atual.username,
        "full_name":    campos.get("full_name")    if campos.get("full_name")    is not None else (atual.full_name or ""),
        "biography":    campos.get("biography")    if campos.get("biography")    is not None else (atual.biography or ""),
        "external_url": campos.get("external_url") if campos.get("external_url") is not None else str(atual.external_url or ""),
        "gender":       int(genero),
    }

    for chave in ("email", "phone_number"):
        valor = getattr(atual, chave, None)
        if valor:
            payload[chave] = str(valor)

    client.private_request("accounts/edit_profile/", client.with_default_data(payload))


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
    if not campos and body.gender is None:
        raise HTTPException(
            status_code=400,
            detail={"code": "NOTHING_TO_EDIT", "message": "Envie ao menos um campo para alterar"},
        )

    entry = await session_pool.get_entry(body.account_id)
    async with entry["lock"]:
        client = entry["client"]
        loop   = asyncio.get_running_loop()

        def _aplicar():
            # Com gênero, uma única chamada direta cobre tudo — o endpoint
            # sobrescreve o perfil, então dividir em duas faria a segunda desfazer
            # parte da primeira. Sem gênero, usa account_edit, que é o caminho
            # público e já resolve o merge com os valores atuais.
            if body.gender is not None:
                _edit_com_genero(client, campos, body.gender)
                return client.account_info()
            return client.account_edit(**campos)

        try:
            conta = await loop.run_in_executor(None, _aplicar)
        except Exception as e:
            logger.exception("profile_edit: failed for account %s", body.account_id)
            code = session_pool.classify_error(e)
            raise HTTPException(status_code=422, detail={"code": code, "message": str(e)[:300]})
        settings = client.get_settings()

    alterados = sorted(campos) + (["gender"] if body.gender is not None else [])
    session_pool._slog("PROFILE_EDITED", body.account_id, campos=",".join(alterados))
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
