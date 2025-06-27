import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  FileText, 
  User, 
  Calendar, 
  Stethoscope, 
  Edit, 
  Save, 
  X, 
  Plus,
  Clock,
  Eye,
  ArrowLeft,
  Search,
  Filter
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
  anamnesis: string;
  physical_examination: string;
  diagnosis: string;
  treatment_plan: string;
  clinical_evolution: string;
  internal_notes: string;
  professional_name: string;
  professional_registration: string;
  created_at: string;
  updated_at: string;
};

type Patient = {
  id: number;
  name: string;
  cpf: string;
  phone: string;
  birth_date: string;
  is_convenio_patient: boolean;
};

const MedicalRecordsPage: React.FC = () => {
  const { user } = useAuth();
  const { patientId } = useParams();
  const navigate = useNavigate();
  
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [medicalRecords, setMedicalRecords] = useState<MedicalRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Modal states
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  // Search and filter
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredPatients, setFilteredPatients] = useState<Patient[]>([]);
  
  // Form state for medical record
  const [recordForm, setRecordForm] = useState({
    chief_complaint: '',
    anamnesis: '',
    physical_examination: '',
    diagnosis: '',
    treatment_plan: '',
    clinical_evolution: '',
    internal_notes: ''
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
    if (patientId) {
      const patient = patients.find(p => p.id === parseInt(patientId));
      if (patient) {
        setSelectedPatient(patient);
        fetchMedicalRecords(parseInt(patientId));
      }
    }
  }, [patientId, patients]);

  useEffect(() => {
    // Filter patients based on search term
    if (searchTerm.trim() === '') {
      setFilteredPatients(patients);
    } else {
      const filtered = patients.filter(patient =>
        patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        patient.cpf.includes(searchTerm.replace(/\D/g, ''))
      );
      setFilteredPatients(filtered);
    }
  }, [searchTerm, patients]);

  const fetchPatients = async () => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/agenda/patients`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setPatients(data);
        setFilteredPatients(data);
      }
    } catch (error) {
      console.error('Error fetching patients:', error);
      setError('Erro ao carregar pacientes');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMedicalRecords = async (patientId: number) => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const response = await fetch(`${apiUrl}/api/medical-records/patient/${patientId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setMedicalRecords(data);
      }
    } catch (error) {
      console.error('Error fetching medical records:', error);
      setError('Erro ao carregar prontuários');
    }
  };

  const handlePatientSelect = (patient: Patient) => {
    setSelectedPatient(patient);
    fetchMedicalRecords(patient.id);
    navigate(`/professional/medical-records/${patient.id}`);
  };

  const openRecordModal = (record?: MedicalRecord) => {
    if (record) {
      setSelectedRecord(record);
      setRecordForm({
        chief_complaint: record.chief_complaint || '',
        anamnesis: record.anamnesis || '',
        physical_examination: record.physical_examination || '',
        diagnosis: record.diagnosis || '',
        treatment_plan: record.treatment_plan || '',
        clinical_evolution: record.clinical_evolution || '',
        internal_notes: record.internal_notes || ''
      });
      setIsEditing(true);
    } else {
      setSelectedRecord(null);
      setRecordForm({
        chief_complaint: '',
        anamnesis: '',
        physical_examination: '',
        diagnosis: '',
        treatment_plan: '',
        clinical_evolution: '',
        internal_notes: ''
      });
      setIsEditing(false);
    }
    setShowRecordModal(true);
  };

  const openViewModal = (record: MedicalRecord) => {
    setSelectedRecord(record);
    setShowViewModal(true);
  };

  const handleSaveRecord = async () => {
    if (!selectedPatient) return;

    try {
      const token = localStorage.getItem('token');
      const apiUrl = getApiUrl();

      const url = isEditing && selectedRecord 
        ? `${apiUrl}/api/medical-records/${selectedRecord.id}`
        : `${apiUrl}/api/medical-records`;

      const method = isEditing ? 'PUT' : 'POST';
      
      const body = isEditing 
        ? recordForm
        : {
            patient_id: selectedPatient.id,
            ...recordForm
          };

      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (response.ok) {
        setSuccess(isEditing ? 'Prontuário atualizado com sucesso!' : 'Prontuário criado com sucesso!');
        setShowRecordModal(false);
        fetchMedicalRecords(selectedPatient.id);
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'Erro ao salvar prontuário');
      }
    } catch (error) {
      console.error('Error saving medical record:', error);
      setError('Erro ao salvar prontuário');
    }
  };

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR });
  };

  const formatCpf = (cpf: string) => {
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando prontuários...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <button
            onClick={() => navigate('/professional/patients')}
            className="mr-4 p-2 text-gray-600 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center">
              <FileText className="h-8 w-8 text-red-600 mr-3" />
              Prontuários Médicos
            </h1>
            <p className="text-gray-600">Gerencie os prontuários dos seus pacientes</p>
          </div>
        </div>

        {selectedPatient && (
          <button
            onClick={() => openRecordModal()}
            className="btn btn-primary flex items-center"
          >
            <Plus className="h-5 w-5 mr-2" />
            Novo Prontuário
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Patient List */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold mb-4">Pacientes</h2>
            
            {/* Search */}
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar paciente..."
                  className="input pl-10"
                />
              </div>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredPatients.map((patient) => (
                <button
                  key={patient.id}
                  onClick={() => handlePatientSelect(patient)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedPatient?.id === patient.id
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex items-center">
                    <User className="h-5 w-5 mr-3 text-gray-500" />
                    <div className="flex-1">
                      <p className="font-medium">{patient.name}</p>
                      <p className="text-sm text-gray-500">CPF: {formatCpf(patient.cpf)}</p>
                      {patient.is_convenio_patient && (
                        <span className="inline-block bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full mt-1">
                          Convênio
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
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
              </div>

              {medicalRecords.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                  <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    Nenhum prontuário encontrado
                  </h3>
                  <p className="text-gray-600 mb-4">
                    Este paciente ainda não possui prontuários médicos.
                  </p>
                  <button
                    onClick={() => openRecordModal()}
                    className="btn btn-primary inline-flex items-center"
                  >
                    <Plus className="h-5 w-5 mr-2" />
                    Criar Primeiro Prontuário
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {medicalRecords.map((record) => (
                    <div key={record.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center mb-2">
                            <Calendar className="h-5 w-5 text-gray-500 mr-2" />
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
                            <Stethoscope className="h-4 w-4 mr-1" />
                            <span>{record.professional_name}</span>
                            {record.professional_registration && (
                              <span className="ml-2">- Registro: {record.professional_registration}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 ml-4">
                          <button
                            onClick={() => openViewModal(record)}
                            className="p-2 text-blue-600 hover:text-blue-800 transition-colors"
                            title="Visualizar"
                          >
                            <Eye className="h-5 w-5" />
                          </button>
                          <button
                            onClick={() => openRecordModal(record)}
                            className="p-2 text-gray-600 hover:text-gray-800 transition-colors"
                            title="Editar"
                          >
                            <Edit className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="text-center py-12">
                <User className="h-16 w-16 text-gray-400 mx-auto mb-4" />
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

      {/* Success/Error Messages */}
      {success && (
        <div className="fixed top-4 right-4 bg-green-50 text-green-600 p-4 rounded-lg shadow-lg z-50">
          {success}
        </div>
      )}

      {error && (
        <div className="fixed top-4 right-4 bg-red-50 text-red-600 p-4 rounded-lg shadow-lg z-50">
          {error}
        </div>
      )}

      {/* Medical Record Form Modal */}
      {showRecordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">
                  {isEditing ? 'Editar Prontuário' : 'Novo Prontuário'}
                </h2>
                <button
                  onClick={() => setShowRecordModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Motivo da Consulta
                  </label>
                  <textarea
                    value={recordForm.chief_complaint}
                    onChange={(e) => setRecordForm({...recordForm, chief_complaint: e.target.value})}
                    className="input min-h-[80px]"
                    placeholder="Descreva o motivo principal da consulta..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Anamnese
                  </label>
                  <textarea
                    value={recordForm.anamnesis}
                    onChange={(e) => setRecordForm({...recordForm, anamnesis: e.target.value})}
                    className="input min-h-[80px]"
                    placeholder="Histórico médico e sintomas..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Exame Físico
                  </label>
                  <textarea
                    value={recordForm.physical_examination}
                    onChange={(e) => setRecordForm({...recordForm, physical_examination: e.target.value})}
                    className="input min-h-[80px]"
                    placeholder="Resultados do exame físico..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Diagnóstico
                  </label>
                  <textarea
                    value={recordForm.diagnosis}
                    onChange={(e) => setRecordForm({...recordForm, diagnosis: e.target.value})}
                    className="input min-h-[80px]"
                    placeholder="Diagnóstico médico..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Plano de Tratamento
                  </label>
                  <textarea
                    value={recordForm.treatment_plan}
                    onChange={(e) => setRecordForm({...recordForm, treatment_plan: e.target.value})}
                    className="input min-h-[80px]"
                    placeholder="Tratamento prescrito..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Evolução Clínica
                  </label>
                  <textarea
                    value={recordForm.clinical_evolution}
                    onChange={(e) => setRecordForm({...recordForm, clinical_evolution: e.target.value})}
                    className="input min-h-[80px]"
                    placeholder="Evolução do quadro clínico..."
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Observações Internas
                  </label>
                  <textarea
                    value={recordForm.internal_notes}
                    onChange={(e) => setRecordForm({...recordForm, internal_notes: e.target.value})}
                    className="input min-h-[100px]"
                    placeholder="Notas internas do profissional (não visível ao paciente)..."
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowRecordModal(false)}
                  className="btn btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveRecord}
                  className="btn btn-primary flex items-center"
                >
                  <Save className="h-5 w-5 mr-2" />
                  {isEditing ? 'Atualizar' : 'Salvar'} Prontuário
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
                  <X className="h-6 w-6" />
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

                {selectedRecord.anamnesis && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Anamnese</h3>
                    <p className="text-gray-700 bg-gray-50 p-3 rounded-lg">{selectedRecord.anamnesis}</p>
                  </div>
                )}

                {selectedRecord.physical_examination && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Exame Físico</h3>
                    <p className="text-gray-700 bg-gray-50 p-3 rounded-lg">{selectedRecord.physical_examination}</p>
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

                {selectedRecord.clinical_evolution && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Evolução Clínica</h3>
                    <p className="text-gray-700 bg-gray-50 p-3 rounded-lg">{selectedRecord.clinical_evolution}</p>
                  </div>
                )}

                {selectedRecord.internal_notes && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Observações Internas</h3>
                    <p className="text-gray-700 bg-yellow-50 p-3 rounded-lg border-l-4 border-yellow-400">{selectedRecord.internal_notes}</p>
                  </div>
                )}
              </div>

              {/* Digital Signature */}
              <div className="mt-8 pt-6 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Assinatura Digital:</p>
                    <p className="font-medium text-gray-900">{selectedRecord.professional_name}</p>
                    {selectedRecord.professional_registration && (
                      <p className="text-sm text-gray-600">Registro: {selectedRecord.professional_registration}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600">Criado em:</p>
                    <p className="text-sm text-gray-900">{formatDate(selectedRecord.created_at)}</p>
                    {selectedRecord.updated_at !== selectedRecord.created_at && (
                      <>
                        <p className="text-sm text-gray-600 mt-1">Atualizado em:</p>
                        <p className="text-sm text-gray-900">{formatDate(selectedRecord.updated_at)}</p>
                      </>
                    )}
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

export default MedicalRecordsPage;