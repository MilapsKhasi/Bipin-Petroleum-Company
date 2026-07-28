import React from 'react';

interface LogoProps {
  className?: string;
  size?: number;
}

const Logo: React.FC<LogoProps> = ({ className = '', size = 40 }) => {
  return (
    <div 
      className={`relative flex items-center justify-center rounded-[10px] overflow-hidden bg-primary ${className}`}
      style={{ width: size, height: size }}
    >
      <div className="relative w-full h-full flex flex-col items-center justify-center">
        <span className="text-white font-bold leading-none select-none" style={{ fontSize: size * 0.6, fontFamily: "'Dancing Script', cursive" }}>B</span>
      </div>
    </div>
  );
};

export default Logo;