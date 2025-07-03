import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { 
  Building2, 
  MapPin, 
  Phone, 
  Mail, 
  Edit, 
  Save, 
  X, 
  Eye, 
  EyeOff, 
  Check, 
  AlertCircle 
} from 'lucide-react';

type ClinicProfile = {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  address_number: string;
  address_complement: string;
  neighborhood: string;
  city: string;
  state: string;
  photo_url: string;
};

const ClinicProfilePage: React.FC = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ClinicProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Password change state
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  });

  const getApiUrl = () => {
    if (
      window.location.hostname === "cartaoquiroferreira.com.br" ||
      window.location.hostname === "www.cartaoquiroferreira.com.br"
    ) {
      return "https://www.cartaoquiroferreira.com.br";
    }
    return "http://localhost:3001";
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/users/${user?.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setProfile(data);
      } else {
        throw new Error('Erro ao carregar perfil');
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      setError('Erro ao carregar perfil');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError('As senhas não coincidem');
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      setError('A nova senha deve ter pelo menos 6 caracteres');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/users/change-password`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword
        })
      });

      if (response.ok) {
        setSuccess('Senha alterada com sucesso!');
        setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
        setShowPasswordForm(false);
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Erro ao alterar senha');
      }
    } catch (error) {
      console.error('Error changing password:', error);
      setError('Erro ao alterar senha');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando perfil...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center">
          <Building2 className="h-8 w-8 text-purple-600 mr-3" />
          Perfil da Clínica
        </h1>
        <p className="text-gray-600">Gerencie as informações da sua clínica</p>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="bg-green-50 text-green-600 p-4 rounded-lg mb-6">
          {success}
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-6">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile Information */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold mb-4">Informações da Clínica</h2>
          
          {profile && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Nome</label>
                <p className="text-gray-900">{profile.name}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <p className="text-gray-900">{profile.email || 'Não informado'}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Telefone</label>
                <p className="text-gray-900">{profile.phone || 'Não informado'}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Endereço</label>
                <p className="text-gray-900">
                  {[
                    profile.address,
                    profile.address_number,
                    profile.address_complement,
                    profile.neighborhood,
                    profile.city,
                    profile.state
                  ].filter(Boolean).join(', ') || 'Não informado'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Password Change */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Segurança</h2>
            <button
              onClick={() => setShowPasswordForm(!showPasswordForm)}
              className="btn btn-outline flex items-center"
            >
              {showPasswordForm ? 'Cancelar' : 'Alterar Senha'}
            </button>
          </div>

          {showPasswordForm ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Senha Atual
                </label>
                <div className="relative">
                  <input
                    type={showPasswords.current ? "text" : "password"}
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm({...passwordForm, currentPassword: e.target.value})}
                    className="input pr-10"
                    placeholder="Digite sua senha atual"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords({...showPasswords, current: !showPasswords.current})}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                  >
                    {showPasswords.current ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nova Senha
                </label>
                <div className="relative">
                  <input
                    type={showPasswords.new ? "text" : "password"}
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                    className="input pr-10"
                    placeholder="Digite a nova senha"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords({...showPasswords, new: !showPasswords.new})}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                  >
                    {showPasswords.new ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirmar Nova Senha
                </label>
                <div className="relative">
                  <input
                    type={showPasswords.confirm ? "text" : "password"}
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm({...passwordForm, confirmPassword: e.target.value})}
                    className="input pr-10"
                    placeholder="Confirme a nova senha"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords({...showPasswords, confirm: !showPasswords.confirm})}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                  >
                    {showPasswords.confirm ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowPasswordForm(false);
                    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
                  }}
                  className="btn btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  onClick={handlePasswordChange}
                  className="btn btn-primary flex items-center"
                  disabled={!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword}
                >
                  <Save className="h-5 w-5 mr-2" />
                  Salvar Senha
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center">
                <AlertCircle className="h-5 w-5 text-purple-600 mr-2" />
                <p className="text-gray-700">
                  Mantenha sua senha segura e altere-a periodicamente para maior segurança.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Contact Information */}
      <div className="mt-6 bg-purple-50 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-purple-900 mb-3 flex items-center">
          <Building2 className="h-5 w-5 mr-2" />
          Informações de Contato
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="flex items-center">
            <Phone className="h-4 w-4 text-purple-600 mr-2" />
            <span className="text-purple-800">
              <strong>Telefone:</strong> {profile?.phone || '(64) 98124-9199'}
            </span>
          </div>
          <div className="flex items-center">
            <Mail className="h-4 w-4 text-purple-600 mr-2" />
            <span className="text-purple-800">
              <strong>Email:</strong> {profile?.email || 'contato@cartaoquiroferreira.com.br'}
            </span>
          </div>
          <div className="flex items-center">
            <MapPin className="h-4 w-4 text-purple-600 mr-2" />
            <span className="text-purple-800">
              <strong>Endereço:</strong> {profile?.address ? `${profile.address}, ${profile.address_number}` : 'Endereço não informado'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClinicProfilePage;