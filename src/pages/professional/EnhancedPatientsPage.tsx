import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { 
  Users, 
  UserPlus, 
  Search, 
  Phone, 
  MapPin, 
  Calendar, 
  Edit, 
  Trash2, 
  X, 
  Check, 
  AlertCircle,
  Archive,
  ArchiveRestore,
  Filter,
  FileText
} from 'lucide-react';
import { Link } from 'react-router-dom';

type Patient = {
  id: number;
  name: string;
  cpf: string;
  email: string;
  phone: string;
  birth_date: string;
  address: string;
  address_number: string;
  address_complement: string;
  neighborhood: string;
  city: string;
  state: string;
  linked_at: string;
  notes: string;
  is_convenio_patient: boolean;
  is_archived: boolean;
};

const EnhancedPatientsPage: React.FC = () => {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [filteredPatients, setFilteredPatients] = useState<Patient[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'convenio' | 'particular'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    cpf: '',
    email: '',
    phone: '',
    birth_date: '',
    address: '',
    address_number: '',
    address_complement: '',
    neighborhood: '',
    city: '',
    state: '',
    notes: ''
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
    fetchPatients();
  }, []);

  useEffect(() => {
    // Apply filters
    let filtered = patients;

    // Filter by archived status
    filtered = filtered.filter(patient => 
      showArchived ? patient.is_archived : !patient.is_archived
    );

    // Filter by type
    if (filterType === 'convenio') {
      filtered = filtered.filter(patient => patient.is_convenio_patient);
    } else if (filterType === 'particular') {
      filtered = filtered.filter(patient => !patient.is_convenio_patient);
    }

    // Filter by search term
    if (searchTerm.trim() !== '') {
      filtered = filtered.filter(patient =>
        patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        patient.cpf.includes(searchTerm.replace(/\D/g, '')) ||
        patient.phone?.includes(searchTerm.replace(/\D/g, ''))
      );
    }

    setFilteredPatients(filtered);
  }, [searchTerm, patients, showArchived, filterType]);

  const fetchPatients = async () => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/agenda/patients?include_archived=true`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setPatients(data);
      } else if (response.status === 403) {
        setError('Assinatura da agenda necessária para acessar pacientes');
      } else {
        setError('Erro ao carregar pacientes');
      }
    } catch (error) {
      console.error('Error fetching patients:', error);
      setError('Erro ao carregar pacientes');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddPatient = async () => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/agenda/patients`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        const newPatient = await response.json();
        setPatients([...patients, newPatient]);
        setSuccess('Paciente adicionado com sucesso!');
        setShowAddModal(false);
        resetForm();
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Erro ao adicionar paciente');
      }
    } catch (error) {
      console.error('Error adding patient:', error);
      setError('Erro ao adicionar paciente');
    }
  };

  const handleUpdateNotes = async (patientId: number, notes: string) => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/agenda/patients/${patientId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ notes })
      });

      if (response.ok) {
        setSuccess('Observações atualizadas com sucesso!');
        fetchPatients();
      } else {
        setError('Erro ao atualizar observações');
      }
    } catch (error) {
      console.error('Error updating patient notes:', error);
      setError('Erro ao atualizar observações');
    }
  };

  const handleArchivePatient = async (patientId: number, archive: boolean) => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/agenda/patients/${patientId}/archive`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ is_archived: archive })
      });

      if (response.ok) {
        setSuccess(archive ? 'Paciente arquivado com sucesso!' : 'Paciente restaurado com sucesso!');
        fetchPatients();
      } else {
        setError(archive ? 'Erro ao arquivar paciente' : 'Erro ao restaurar paciente');
      }
    } catch (error) {
      console.error('Error archiving patient:', error);
      setError(archive ? 'Erro ao arquivar paciente' : 'Erro ao restaurar paciente');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      cpf: '',
      email: '',
      phone: '',
      birth_date: '',
      address: '',
      address_number: '',
      address_complement: '',
      neighborhood: '',
      city: '',
      state: '',
      notes: ''
    });
  };

  const formatCpf = (cpf: string) => {
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  };

  const formatPhone = (phone: string) => {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11) {
      return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
    }
    return phone;
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR');
  };

  const openEditModal = (patient: Patient) => {
    setSelectedPatient(patient);
    setFormData({
      name: patient.name,
      cpf: patient.cpf,
      email: patient.email || '',
      phone: patient.phone || '',
      birth_date: patient.birth_date || '',
      address: patient.address || '',
      address_number: patient.address_number || '',
      address_complement: patient.address_complement || '',
      neighborhood: patient.neighborhood || '',
      city: patient.city || '',
      state: patient.state || '',
      notes: patient.notes || ''
    });
    setShowEditModal(true);
  };

  const clearFilters = () => {
    setSearchTerm('');
    setFilterType('all');
    setShowArchived(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando pacientes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            <Users className="h-8 w-8 text-red-600 mr-3" />
            Meus Pacientes
          </h1>
          <p className="text-gray-600">Gerencie seus pacientes particulares e do convênio</p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="btn btn-primary flex items-center"
        >
          <UserPlus className="h-5 w-5 mr-2" />
          Adicionar Paciente
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center mb-4">
          <Filter className="h-5 w-5 text-red-600 mr-2" />
          <h2 className="text-lg font-semibold">Filtros</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Buscar
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Nome, CPF ou telefone..."
                className="input pl-10"
              />
            </div>
          </div>

          {/* Type Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tipo
            </label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as 'all' | 'convenio' | 'particular')}
              className="input"
            >
              <option value="all">Todos</option>
              <option value="convenio">Convênio</option>
              <option value="particular">Particular</option>
            </select>
          </div>

          {/* Archived Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={showArchived ? 'archived' : 'active'}
              onChange={(e) => setShowArchived(e.target.value === 'archived')}
              className="input"
            >
              <option value="active">Ativos</option>
              <option value="archived">Arquivados</option>
            </select>
          </div>

          {/* Clear Filters */}
          <div className="flex items-end">
            <button
              onClick={clearFilters}
              className="btn btn-secondary w-full"
            >
              Limpar Filtros
            </button>
          </div>
        </div>

        {/* Filter Summary */}
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {filteredPatients.length} paciente(s) encontrado(s)
            {searchTerm && ` para "${searchTerm}"`}
            {filterType !== 'all' && ` • Tipo: ${filterType === 'convenio' ? 'Convênio' : 'Particular'}`}
            {showArchived && ' • Arquivados'}
          </div>
        </div>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
            <p className="text-red-700">{error}</p>
          </div>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border-l-4 border-green-400 p-4 mb-6">
          <div className="flex items-center">
            <Check className="h-5 w-5 text-green-600 mr-2" />
            <p className="text-green-700">{success}</p>
          </div>
        </div>
      )}

      {/* Patients List */}
      {filteredPatients.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <Users className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchTerm || filterType !== 'all' || showArchived 
              ? 'Nenhum paciente encontrado' 
              : 'Nenhum paciente cadastrado'
            }
          </h3>
          <p className="text-gray-600 mb-4">
            {searchTerm || filterType !== 'all' || showArchived
              ? 'Tente ajustar os filtros de busca'
              : 'Comece adicionando seus primeiros pacientes'
            }
          </p>
          {!searchTerm && filterType === 'all' && !showArchived && (
            <button
              onClick={() => setShowAddModal(true)}
              className="btn btn-primary inline-flex items-center"
            >
              <UserPlus className="h-5 w-5 mr-2" />
              Adicionar Primeiro Paciente
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPatients.map((patient) => (
            <div 
              key={patient.id} 
              className={`bg-white rounded-xl shadow-sm border p-6 hover:shadow-md transition-shadow ${
                patient.is_archived ? 'border-gray-300 bg-gray-50' : 'border-gray-100'
              }`}
            >
              {/* Patient Header */}
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <h3 className={`text-lg font-semibold ${patient.is_archived ? 'text-gray-600' : 'text-gray-900'}`}>
                    {patient.name}
                  </h3>
                  <p className="text-sm text-gray-500">CPF: {formatCpf(patient.cpf)}</p>
                  <div className="flex items-center space-x-2 mt-1">
                    {patient.is_convenio_patient && (
                      <span className="inline-block bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
                        Convênio
                      </span>
                    )}
                    {patient.is_archived && (
                      <span className="inline-block bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded-full">
                        Arquivado
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Link
                    to={`/professional/medical-records/${patient.id}`}
                    className="text-blue-600 hover:text-blue-800"
                    title="Ver Prontuários"
                  >
                    <FileText className="h-4 w-4" />
                  </Link>
                  <button
                    onClick={() => openEditModal(patient)}
                    className="text-gray-600 hover:text-gray-800"
                    title="Editar"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleArchivePatient(patient.id, !patient.is_archived)}
                    className={`${patient.is_archived ? 'text-green-600 hover:text-green-800' : 'text-orange-600 hover:text-orange-800'}`}
                    title={patient.is_archived ? 'Restaurar' : 'Arquivar'}
                  >
                    {patient.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Contact Info */}
              <div className="space-y-2 mb-4">
                {patient.phone && (
                  <div className="flex items-center text-sm text-gray-600">
                    <Phone className="h-4 w-4 mr-2" />
                    <span>{formatPhone(patient.phone)}</span>
                    <a
                      href={`https://wa.me/55${patient.phone.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-green-600 hover:text-green-800"
                    >
                      WhatsApp
                    </a>
                  </div>
                )}

                {patient.birth_date && (
                  <div className="flex items-center text-sm text-gray-600">
                    <Calendar className="h-4 w-4 mr-2" />
                    <span>Nascimento: {formatDate(patient.birth_date)}</span>
                  </div>
                )}

                {(patient.address || patient.city) && (
                  <div className="flex items-start text-sm text-gray-600">
                    <MapPin className="h-4 w-4 mr-2 mt-0.5" />
                    <span>
                      {[patient.address, patient.address_number, patient.neighborhood, patient.city, patient.state]
                        .filter(Boolean)
                        .join(', ')}
                    
                    </span>
                  </div>
                )}
              </div>

              {/* Notes */}
              {patient.notes && (
                <div className="bg-gray-50 p-3 rounded-lg mb-4">
                  <p className="text-sm text-gray-700">{patient.notes}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-between items-center pt-4 border-t border-gray-100">
                <span className="text-xs text-gray-500">
                  Vinculado em {formatDate(patient.linked_at)}
                </span>
                <Link
                  to={`/professional/medical-records/${patient.id}`}
                  className="text-red-600 hover:text-red-700 text-sm font-medium"
                >
                  Ver Prontuários
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Patient Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Adicionar Novo Paciente</h2>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nome Completo *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="input"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    CPF *
                  </label>
                  <input
                    type="text"
                    value={formData.cpf}
                    onChange={(e) => setFormData({...formData, cpf: e.target.value.replace(/\D/g, '')})}
                    className="input"
                    placeholder="00000000000"
                    maxLength={11}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    className="input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Telefone
                  </label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value.replace(/\D/g, '')})}
                    className="input"
                    placeholder="11999999999"
                    maxLength={11}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Data de Nascimento
                  </label>
                  <input
                    type="date"
                    value={formData.birth_date}
                    onChange={(e) => setFormData({...formData, birth_date: e.target.value})}
                    className="input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Estado
                  </label>
                  <select
                    value={formData.state}
                    onChange={(e) => setFormData({...formData, state: e.target.value})}
                    className="input"
                  >
                    <option value="">Selecione...</option>
                    <option value="GO">Goiás</option>
                    <option value="DF">Distrito Federal</option>
                    <option value="SP">São Paulo</option>
                    <option value="RJ">Rio de Janeiro</option>
                    <option value="MG">Minas Gerais</option>
                    {/* Add more states as needed */}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Endereço
                  </label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({...formData, address: e.target.value})}
                    className="input"
                    placeholder="Rua, Avenida..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Número
                  </label>
                  <input
                    type="text"
                    value={formData.address_number}
                    onChange={(e) => setFormData({...formData, address_number: e.target.value})}
                    className="input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Complemento
                  </label>
                  <input
                    type="text"
                    value={formData.address_complement}
                    onChange={(e) => setFormData({...formData, address_complement: e.target.value})}
                    className="input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Bairro
                  </label>
                  <input
                    type="text"
                    value={formData.neighborhood}
                    onChange={(e) => setFormData({...formData, neighborhood: e.target.value})}
                    className="input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cidade
                  </label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({...formData, city: e.target.value})}
                    className="input"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Observações
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    className="input min-h-[80px]"
                    placeholder="Observações sobre o paciente..."
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="btn btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAddPatient}
                  className="btn btn-primary"
                  disabled={!formData.name || !formData.cpf}
                >
                  Adicionar Paciente
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Patient Modal */}
      {showEditModal && selectedPatient && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Editar Observações</h2>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Paciente:</strong> {selectedPatient.name}
                </p>
                <p className="text-sm text-gray-600">
                  <strong>CPF:</strong> {formatCpf(selectedPatient.cpf)}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Observações
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  className="input min-h-[120px]"
                  placeholder="Observações sobre o paciente..."
                />
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="btn btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    handleUpdateNotes(selectedPatient.id, formData.notes);
                    setShowEditModal(false);
                  }}
                  className="btn btn-primary"
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnhancedPatientsPage;