import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  FileText, 
  Users, 
  Search, 
  Filter, 
  AlertCircle, 
  CheckCircle, 
  Building2,
  ArrowLeft
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type MedicalRecord = {
  id: number;
  consultation_id: number;
  patient_id: number;
  patient_name: string;
  patient_cpf: string;
  consultation_date: string;
  service_name: string;
  chief_complaint: string;
  diagnosis: string;
  treatment_plan: string;
  professional_name: string;
  professional_id: number;
  created_at: string;
};

type Patient = {
  id: number;
  name: string;
  cpf: string;
  is_convenio_patient: boolean;
  professional_id: number;
  professional_name: string;
};

const ClinicMedicalRecordsPage: React.FC = () => {
  const { user } = useAuth();
  const { patientId } = useParams();
  const navigate = useNavigate();
  
  const [patients, setPatients] = useState<Patient[]>([]);
  const [filteredPatients, setFilteredPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [medicalRecords, setMedicalRecords] = useState<MedicalRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [professionals, setProfessionals] = useState<{id: number, name: string}[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'convenio' | 'particular'>('all');
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<number | null>(null);
  
  // Modal state
  const [showViewModal, setShowViewModal] = useState(false);

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
    fetchData();
  }, []);

  useEffect(() => {
    if (patientId) {
      const patient = patients.find(p => p.id === parseInt(patientId));
      if (patient) {
        setSelectedPatient(patient);
        fetchMedicalRecords(parseInt(patientId));
      }
    }
  }, [patientId, patients]);

  useEffect(() => {
    // Apply filters
    let filtered = patients;

    // Filter by type
    if (filterType === 'convenio') {
      filtered = filtered.filter(patient => patient.is_convenio_patient);
    } else if (filterType === 'particular') {
      filtered = filtered.filter(patient => !patient.is_convenio_patient);
    }

    // Filter by professional
    if (selectedProfessionalId) {
      filtered = filtered.filter(patient => patient.professional_id === selectedProfessionalId);
    }

    // Filter by search term
    if (searchTerm.trim() !== '') {
      filtered = filtered.filter(patient =>
        patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        patient.cpf.includes(searchTerm.replace(/\D/g, ''))
      );
    }

    setFilteredPatients(filtered);
  }, [searchTerm, patients, filterType, selectedProfessionalId]);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      // Fetch professionals
      const professionalsResponse = await fetch(`${apiUrl}/api/clinic/professionals`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (professionalsResponse.ok) {
        const professionalsData = await professionalsResponse.json();
        setProfessionals(professionalsData);
      }

      // Fetch patients
      const patientsResponse = await fetch(`${apiUrl}/api/clinic/patients`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (patientsResponse.ok) {
        const patientsData = await patientsResponse.json();
        setPatients(patientsData);
        setFilteredPatients(patientsData);
      } else {
        throw new Error('Erro ao carregar pacientes');
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Não foi possível carregar os dados');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMedicalRecords = async (patientId: number) => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/clinic/medical-records/patient/${patientId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setMedicalRecords(data);
      } else {
        throw new Error('Erro ao carregar prontuários');
      }
    } catch (error) {
      console.error('Error fetching medical records:', error);
      setError('Não foi possível carregar os prontuários');
    }
  };

  const handlePatientSelect = (patient: Patient) => {
    setSelectedPatient(patient);
    fetchMedicalRecords(patient.id);
    navigate(`/clinic/medical-records/${patient.id}`);
  };

  const openViewModal = (record: MedicalRecord) => {
    setSelectedRecord(record);
    setShowViewModal(true);
  };

  const resetFilters = () => {
    setSearchTerm('');
    setFilterType('all');
    setSelectedProfessionalId(null);
  };

  const formatCpf = (cpf: string) => {
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  };

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando prontuários...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center">
          <FileText className="h-8 w-8 text-purple-600 mr-3" />
          Prontuários Médicos
        </h1>
        <p className="text-gray-600">Visualize os prontuários dos pacientes da clínica</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center mb-4">
          <Filter className="h-5 w-5 text-purple-600 mr-2" />
          <h2 className="text-lg font-semibold">Filtrar Pacientes</h2>
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
                placeholder="Nome ou CPF..."
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

          {/* Professional Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Profissional
            </label>
            <select
              value={selectedProfessionalId || ''}
              onChange={(e) => setSelectedProfessionalId(e.target.value ? parseInt(e.target.value) : null)}
              className="input"
            >
              <option value="">Todos os profissionais</option>
              {professionals.map(prof => (
                <option key={prof.id} value={prof.id}>{prof.name}</option>
              ))}
            </select>
          </div>

          {/* Clear Filters */}
          <div className="flex items-end">
            <button
              onClick={resetFilters}
              className="btn btn-secondary w-full"
            >
              Limpar Filtros
            </button>
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
            <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
            <p className="text-green-700">{success}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Patient List */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold mb-4">Pacientes</h2>
            
            {filteredPatients.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 rounded-lg">
                <Users className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">Nenhum paciente encontrado</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredPatients.map((patient) => (
                  <button
                    key={patient.id}
                    onClick={() => handlePatientSelect(patient)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedPatient?.id === patient.id
                        ? 'bg-purple-50 border-purple-200 text-purple-700'
                        : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center">
                      <Users className="h-5 w-5 mr-3 text-gray-500" />
                      <div className="flex-1">
                        <p className="font-medium">{patient.name}</p>
                        <p className="text-sm text-gray-500">CPF: {formatCpf(patient.cpf)}</p>
                        <div className="flex items-center mt-1">
                          <span className={`inline-block text-xs px-2 py-1 rounded-full ${
                            patient.is_convenio_patient
                              ? 'bg-green-100 text-green-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}>
                            {patient.is_convenio_patient ? 'Convênio' : 'Particular'}
                          </span>
                          <span className="text-xs text-gray-500 ml-2">
                            {patient.professional_name}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Medical Records */}
        <div className="lg:col-span-2">
          {selectedPatient ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold">Prontuários de {selectedPatient.name}</h2>
                  <p className="text-sm text-gray-500">CPF: {formatCpf(selectedPatient.cpf)}</p>
                </div>
                <button
                  onClick={() => {
                    setSelectedPatient(null);
                    setMedicalRecords([]);
                    navigate('/clinic/medical-records');
                  }}
                  className="btn btn-outline flex items-center"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Voltar
                </button>
              </div>

              {medicalRecords.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                  <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    Nenhum prontuário encontrado
                  </h3>
                  <p className="text-gray-600">
                    Este paciente ainda não possui prontuários médicos.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {medicalRecords.map((record) => (
                    <div key={record.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center mb-2">
                            <span className="font-medium">{formatDate(record.consultation_date)}</span>
                            <span className="ml-2 text-sm text-gray-500">- {record.service_name}</span>
                          </div>
                          
                          {record.chief_complaint && (
                            <div className="mb-2">
                              <span className="text-sm font-medium text-gray-700">Motivo da consulta:</span>
                              <p className="text-sm text-gray-600 mt-1">{record.chief_complaint}</p>
                            </div>
                          )}
                          
                          {record.diagnosis && (
                            <div className="mb-2">
                              <span className="text-sm font-medium text-gray-700">Diagnóstico:</span>
                              <p className="text-sm text-gray-600 mt-1">{record.diagnosis}</p>
                            </div>
                          )}

                          <div className="flex items-center text-xs text-gray-500 mt-3">
                            <span>Profissional: {record.professional_name}</span>
                          </div>
                        </div>

                        <button
                          onClick={() => openViewModal(record)}
                          className="ml-4 p-2 text-blue-600 hover:text-blue-800 transition-colors"
                          title="Visualizar"
                        >
                          <FileText className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="text-center py-12">
                <Building2 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Selecione um paciente
                </h3>
                <p className="text-gray-600">
                  Escolha um paciente da lista ao lado para visualizar seus prontuários.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* View Medical Record Modal */}
      {showViewModal && selectedRecord && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Prontuário Médico</h2>
                <button
                  onClick={() => setShowViewModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <ArrowLeft className="h-6 w-6" />
                </button>
              </div>

              {/* Patient Info */}
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <span className="text-sm font-medium text-gray-700">Paciente:</span>
                    <p className="text-gray-900">{selectedRecord.patient_name}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-700">Data da Consulta:</span>
                    <p className="text-gray-900">{formatDate(selectedRecord.consultation_date)}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-700">Serviço:</span>
                    <p className="text-gray-900">{selectedRecord.service_name}</p>
                  </div>
                </div>
              </div>

              {/* Medical Record Content */}
              <div className="space-y-6">
                {selectedRecord.chief_complaint && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Motivo da Consulta</h3>
                    <p className="text-gray-700 bg-gray-50 p-3 rounded-lg">{selectedRecord.chief_complaint}</p>
                  </div>
                )}

                {selectedRecord.diagnosis && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Diagnóstico</h3>
                    <p className="text-gray-700 bg-gray-50 p-3 rounded-lg">{selectedRecord.diagnosis}</p>
                  </div>
                )}

                {selectedRecord.treatment_plan && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Plano de Tratamento</h3>
                    <p className="text-gray-700 bg-gray-50 p-3 rounded-lg">{selectedRecord.treatment_plan}</p>
                  </div>
                )}
              </div>

              {/* Digital Signature */}
              <div className="mt-8 pt-6 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Assinatura Digital:</p>
                    <p className="font-medium text-gray-900">{selectedRecord.professional_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600">Criado em:</p>
                    <p className="text-sm text-gray-900">{formatDate(selectedRecord.created_at)}</p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end mt-6">
                <button
                  onClick={() => setShowViewModal(false)}
                  className="btn btn-secondary"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClinicMedicalRecordsPage;