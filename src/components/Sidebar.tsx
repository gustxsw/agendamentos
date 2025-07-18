import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  Home, 
  Users, 
  FileText,
  FilePlus,
  BarChart2, 
  Calendar, 
  UserPlus, 
  CalendarDays, 
  Stethoscope,
  User,
  Settings,
  Building2
} from 'lucide-react';

type SidebarProps = {
  onItemClick?: () => void;
};

const Sidebar: React.FC<SidebarProps> = ({ onItemClick }) => {
  const { user } = useAuth();
  
  // Navigation links based on user current role
  const getNavLinks = () => {
    if (user?.currentRole === 'client') {
      return [
        { to: '/client', icon: <Home size={20} />, label: 'Início' },
        { to: '/client/professionals', icon: <Users size={20} />, label: 'Profissionais' },
      ];
    } else if (user?.currentRole === 'professional') {
      return [
        { to: '/professional', icon: <Home size={20} />, label: 'Início' },
        { to: '/professional/register-consultation', icon: <Calendar size={20} />, label: 'Nova Consulta' },
        { to: '/professional/agenda', icon: <CalendarDays size={20} />,  label: 'Agenda' },
        { to: '/professional/patients', icon: <Stethoscope size={20} />, label: 'Pacientes' },
        { to: '/professional/medical-records', icon: <FileText size={20} />, label: 'Prontuários' },
        { to: '/professional/documents', icon: <FilePlus size={20} />, label: 'Documentos' },
        { to: '/professional/reports', icon: <BarChart2 size={20} />, label: 'Relatórios' },
        { to: '/professional/profile', icon: <User size={20} />, label: 'Perfil' },
      ];
    } else if (user?.currentRole === 'clinic') {
      return [
        { to: '/clinic', icon: <Home size={20} />, label: 'Início' },
        { to: '/clinic/professionals', icon: <Users size={20} />, label: 'Profissionais' },
        { to: '/clinic/register-consultation', icon: <Calendar size={20} />, label: 'Nova Consulta' },
        { to: '/clinic/agenda', icon: <CalendarDays size={20} />, label: 'Agenda' },
        { to: '/clinic/patients', icon: <Stethoscope size={20} />, label: 'Pacientes' },
        { to: '/clinic/medical-records', icon: <FileText size={20} />, label: 'Prontuários' },
        { to: '/clinic/reports', icon: <BarChart2 size={20} />, label: 'Relatórios' },
        { to: '/clinic/profile', icon: <Building2 size={20} />, label: 'Perfil' },
      ];
    } else if (user?.currentRole === 'admin') {
      return [
        { to: '/admin', icon: <Home size={20} />, label: 'Início' },
        { to: '/admin/users', icon: <Users size={20} />, label: 'Usuários' },
        { to: '/admin/services', icon: <FileText size={20} />, label: 'Serviços' },
        { to: '/admin/reports', icon: <BarChart2 size={20} />, label: 'Relatórios' },
      ];
    }
    
    return [];
  };
  
  const navLinks = getNavLinks();
  
  return (
    <aside className="h-full">
      <div className="p-4">
        <div className="pt-4">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              onClick={onItemClick}
              className={({ isActive }) =>
                `flex items-center px-4 py-3 mb-2 rounded-md transition-colors ${
                  isActive
                    ? 'bg-red-50 text-red-600'
                    : 'text-gray-700 hover:bg-gray-100'
                }`
              }
            >
              {link.icon}
              <span className="ml-3">{link.label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;