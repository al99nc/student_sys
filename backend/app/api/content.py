from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_admin
from app.db.database import get_db
from app.models.content import SiteContent
from app.schemas.content import SiteContentUpdate, SiteContentOut

router = APIRouter(prefix="/content", tags=["content"])


@router.get("/{key}", response_model=SiteContentOut)
def get_content(key: str, db: Session = Depends(get_db)):
    content = db.query(SiteContent).filter(SiteContent.key == key).first()
    if not content:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")
    return content


@router.put("/{key}", response_model=SiteContentOut)
def update_content(
    key: str,
    body: SiteContentUpdate,
    _admin: SiteContent = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    content = db.query(SiteContent).filter(SiteContent.key == key).first()
    if not content:
        content = SiteContent(key=key, content=body.content)
        db.add(content)
    else:
        content.content = body.content
    db.commit()
    db.refresh(content)
    return content
