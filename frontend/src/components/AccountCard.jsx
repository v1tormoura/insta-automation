import { deleteAccount } from '../services/api';

function AccountCard({ account, refresh }) {
  async function handleDelete() {
    if (!window.confirm('Excluir conta?')) return;

    try {
      await deleteAccount(account._id);

      refresh();
    } catch (err) {
      alert('Erro ao excluir');
    }
  }

  return (
    <div className="account-card">
      <img src={account.avatar || 'https://i.imgur.com/HeIi0wU.png'} alt="" />

      <h2>{account.name || account.username}</h2>

      <p>@{account.username}</p>

      <p>Seguidores: {account.followers || 0}</p>

      <p>Status: {account.status}</p>

      <button onClick={handleDelete}>Excluir</button>
    </div>
  );
}

export default AccountCard;
