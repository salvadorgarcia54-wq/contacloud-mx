from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import json
from database import Base

class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(100), unique=False, nullable=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(200))
    position = Column(String(100), nullable=True)
    phone = Column(String(50), nullable=True)
    photo_url = Column(Text, nullable=True)
    can_create_clients = Column(Boolean, default=False)
    assigned_client_ids_json = Column("assigned_client_ids", Text, nullable=True, default="[]")
    role = Column(String(20), nullable=False, default='accountant')
    client_id = Column(Integer, ForeignKey('clients.id'), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    client = relationship("Client", back_populates="users")

    @property
    def assigned_client_ids(self):
        if not self.assigned_client_ids_json:
            return []
        try:
            data = json.loads(self.assigned_client_ids_json)
            if isinstance(data, list):
                return [int(x) for x in data if str(x).isdigit() or isinstance(x, int)]
            return []
        except Exception:
            return []

    @assigned_client_ids.setter
    def assigned_client_ids(self, value):
        if value is None:
            self.assigned_client_ids_json = "[]"
        else:
            clean = [int(x) for x in value if str(x).isdigit() or isinstance(x, int)]
            self.assigned_client_ids_json = json.dumps(clean)
